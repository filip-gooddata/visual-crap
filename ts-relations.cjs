// Resolve source-backed function relationships with the target project's TypeScript.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { root, source, findings, files } = JSON.parse(fs.readFileSync(0, 'utf8'));
let ts, packageDir = source;
while (packageDir.startsWith(root)) {
    try { ts = createRequire(path.join(packageDir, 'package.json'))('typescript'); break; } catch {}
    const parent = path.dirname(packageDir);
    if (parent === packageDir) break;
    packageDir = parent;
}
if (!ts) { console.error('TypeScript is not installed in the target project; TypeScript relationships were not analyzed.'); process.stdout.write(JSON.stringify({ available: false, matched: 0, edges: [] })); process.exit(0); }
const configPath = ts.findConfigFile(source, ts.sys.fileExists, 'tsconfig.json');
let options = { allowJs: true, jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.ESNext };
let roots = files.map(f => path.join(root, f));
if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
    if (parsed.errors.length) throw new Error(parsed.errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'));
    options = { ...parsed.options, noEmit: true };
    roots = [...new Set([...roots, ...parsed.fileNames.filter(f => !isTest(f))])];
}
function isTest(file) { return /(?:^|[/\\])(?:__tests__|__mocks__|__fixtures__|testUtils|test-utils|tests|fixtures)(?:[/\\]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/.test(file); }
const program = ts.createProgram(roots, options), checker = program.getTypeChecker();
const sourceFiles = program.getSourceFiles().filter(sf => sf.fileName.startsWith(source + path.sep) && !isTest(sf.fileName));
const relative = sf => path.relative(root, sf.fileName).split(path.sep).join('/');
const key = (file, line, col) => `${file}\0${line}\0${col}`;
const findingKeys = new Map();
findings.forEach((f, i) => { const k = key(f.path, f.line, f.col); if (!findingKeys.has(k)) findingKeys.set(k, []); findingKeys.get(k).push(i); });
const functionIds = new Map(), symbolIds = new Map();
function resolve(s) {
    const seen = new Set();
    while (s && (s.flags & ts.SymbolFlags.Alias)) {
        if (seen.has(s)) return undefined;
        seen.add(s);
        try { s = checker.getAliasedSymbol(s); } catch { return undefined; }
    }
    return s;
}
function functionName(n) {
    if (n.name) return n.name;
    let value = n, parent = n.parent;
    while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent))) { value = parent; parent = parent.parent; }
    while (parent && ts.isCallExpression(parent) && parent.arguments[0] === value) {
        const callee = ts.isPropertyAccessExpression(parent.expression) ? parent.expression.name : parent.expression;
        const sym = resolve(checker.getSymbolAtLocation(callee));
        if (!['useCallback', 'memo', 'forwardRef'].includes(sym?.getName()) || !sym.declarations?.some(d => d.getSourceFile().fileName.includes('/@types/react/'))) break;
        value = parent; parent = parent.parent;
    }
    return parent && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.initializer === value ? parent.name : undefined;
}
for (const sf of sourceFiles) {
    function collect(n) {
        if (ts.isFunctionLike(n) && n.body) {
            const positions = [n.getStart(sf)];
            if (ts.isFunctionDeclaration(n)) { const t = n.getChildren(sf).find(c => c.kind === ts.SyntaxKind.FunctionKeyword); if (t) positions.push(t.getStart(sf)); const async = n.modifiers?.find(m => m.kind === ts.SyntaxKind.AsyncKeyword); if (async) positions.push(async.getStart(sf)); }
            if (ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) { const t = n.getChildren(sf).find(c => c.kind === ts.SyntaxKind.OpenParenToken); if (t) positions.push(t.getStart(sf)); }
            const ids = new Set(positions.flatMap(p => { const loc = sf.getLineAndCharacterOfPosition(p); return findingKeys.get(key(relative(sf), loc.line + 1, loc.character)) || []; }));
            if (ids.size === 1) {
                const id = [...ids][0]; functionIds.set(n, id);
                const name = ts.isConstructorDeclaration(n) ? n.parent.name : functionName(n), symbol = name && resolve(checker.getSymbolAtLocation(name));
                if (symbol) { if (!symbolIds.has(symbol)) symbolIds.set(symbol, new Set()); symbolIds.get(symbol).add(id); }
            }
        }
        ts.forEachChild(n, collect);
    }
    collect(sf);
}
const propertyAssignments = new Map();
function target(expr) {
    while (expr && (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr))) expr = expr.expression;
    if (!expr) return;
    if (functionIds.has(expr)) return functionIds.get(expr);
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
        const owner = resolve(checker.getSymbolAtLocation(expr.expression));
        const assignment = propertyAssignments.get(owner)?.get(expr.name.text);
        if (assignment?.count === 1 && assignment.id !== undefined) return assignment.id;
    }
    const loc = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
    if (!ts.isIdentifier(loc)) return;
    const ids = symbolIds.get(resolve(checker.getSymbolAtLocation(loc)));
    if (ids?.size === 1) return [...ids][0];
}
// Resolve a static property only for a stable binding with a single assignment.
for (const sf of sourceFiles) {
    function scan(n) {
        if (ts.isBinaryExpression(n) && ts.isPropertyAccessExpression(n.left) && ts.isIdentifier(n.left.expression) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
            const owner = resolve(checker.getSymbolAtLocation(n.left.expression));
            const stable = owner?.declarations?.some(d => ts.isFunctionDeclaration(d) || (ts.isVariableDeclaration(d) && (d.parent.flags & ts.NodeFlags.Const)));
            if (stable) {
                if (!propertyAssignments.has(owner)) propertyAssignments.set(owner, new Map());
                const props = propertyAssignments.get(owner), name = n.left.name.text;
                const record = props.get(name) || { count: 0, id: undefined };
                record.count++;
                record.id = n.operatorToken.kind === ts.SyntaxKind.EqualsToken ? target(n.right) : undefined;
                props.set(name, record);
            }
        }
        ts.forEachChild(n, scan);
    }
    scan(sf);
}
function enclosing(node) {
    for (let p = node.parent; p; p = p.parent) {
        if (ts.isFunctionLike(p) && p.body) return functionIds.get(p);
        if (ts.isClassLike(p)) return;
    }
    return { boundary: 'module', path: relative(node.getSourceFile()), line: 1, name: '[module initialization]' };
}
const edges = new Map();
function add(from, to, kind, sf, site) {
    if (from === undefined || to === undefined) return;
    const fromKey = typeof from === 'number' ? from : `${from.boundary}:${from.path}:${from.name}`;
    const k = `${fromKey}\0${to}\0${kind}`;
    if (!edges.has(k)) edges.set(k, [from, to, kind, `${relative(sf)}:${sf.getLineAndCharacterOfPosition(site.getStart(sf)).line + 1}`]);
}
function references(value, from, kind, sf, site, nested = false) {
    if (!value) return;
    while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isNonNullExpression(value)) value = value.expression;
    if (ts.isObjectLiteralExpression(value)) for (const p of value.properties) {
        if (ts.isPropertyAssignment(p)) references(p.initializer, from, kind, sf, site, true);
        else if (ts.isShorthandPropertyAssignment(p)) { const ids = symbolIds.get(resolve(checker.getShorthandAssignmentValueSymbol(p))); if (ids?.size === 1) add(from, [...ids][0], kind, sf, site); }
        else if (ts.isMethodDeclaration(p)) add(from, target(p), kind, sf, site);
    }
    else if (ts.isArrayLiteralExpression(value)) for (const e of value.elements) references(e, from, kind, sf, site, true);
    else if (ts.isConditionalExpression(value)) { references(value.whenTrue, from, kind, sf, site, true); references(value.whenFalse, from, kind, sf, site, true); }
    else if (ts.isBinaryExpression(value) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(value.operatorToken.kind)) { if (value.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) references(value.left, from, kind, sf, site, true); references(value.right, from, kind, sf, site, true); }
    else if (nested) add(from, target(value), kind, sf, site);
}
for (const sf of sourceFiles) {
    function visit(n) {
        const from = enclosing(n);
        if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
            add(from, target(n.expression), ts.isNewExpression(n) ? 'construct' : 'call', sf, n);
            for (const arg of n.arguments || []) { add(from, target(arg), 'passed', sf, arg); references(arg, from, 'configured', sf, arg); }
        } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) add(from, target(n.tagName), 'render', sf, n);
        else if (ts.isJsxAttribute(n) && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) { add(from, target(n.initializer.expression), 'prop', sf, n); references(n.initializer.expression, from, 'configured', sf, n); }
        else if (ts.isVariableDeclaration(n) && n.initializer && (ts.isObjectLiteralExpression(n.initializer) || ts.isArrayLiteralExpression(n.initializer) || ts.isConditionalExpression(n.initializer))) references(n.initializer, from, 'configured', sf, n.initializer);
        else if (ts.isPropertyDeclaration(n) && n.initializer && n.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) && ts.isClassDeclaration(n.parent) && ts.isSourceFile(n.parent.parent)) references(n.initializer, {boundary:'module',path:relative(sf),line:1,name:'[module initialization]'}, 'configured', sf, n);
        else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left))) references(n.right, from, 'configured', sf, n, true);
        else if (ts.isReturnStatement(n) && n.expression) references(n.expression, from, 'returned', sf, n, true);
        else if (ts.isArrowFunction(n) && !ts.isBlock(n.body)) references(n.body, functionIds.get(n), 'returned', sf, n.body, true);
        else if ((ts.isParameter(n) || ts.isBindingElement(n)) && n.initializer) add(from, target(n.initializer), 'default', sf, n.initializer);
        ts.forEachChild(n, visit);
    }
    visit(sf);
}
// A configured package entry is a public boundary, not evidence of a caller.
let packageRoot = source;
while (packageRoot.startsWith(root) && !fs.existsSync(path.join(packageRoot, 'package.json'))) packageRoot = path.dirname(packageRoot);
if (packageRoot.startsWith(root) && fs.existsSync(path.join(packageRoot, 'package.json'))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const candidates = [];
    function entries(value, label, condition = '') {
        if (typeof value === 'string') {
            const file = path.resolve(packageRoot, value);
            if (file.startsWith(source + path.sep) && !isTest(file) && fs.existsSync(file)) candidates.push({file, label, condition});
        } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) entries(child, key.startsWith('.') ? key : label, key.startsWith('.') ? condition : key);
    }
    entries(pkg.exports, '.');
    for (const field of ['source', 'main', 'module']) if (pkg[field]) entries(pkg[field], '.', field);
    for (const entry of candidates) {
        const sf = program.getSourceFile(entry.file), moduleSymbol = sf && checker.getSymbolAtLocation(sf);
        if (!moduleSymbol) continue;
        const boundary = {boundary: 'entry', path: relative(sf), line: 1, name: `[package entry ${entry.label}]`};
        const seen = new Set();
        function walk(sym, prefix) {
            if (seen.has(sym)) return;
            seen.add(sym);
            for (const exp of checker.getExportsOfModule(sym)) {
                if (exp.declarations?.length && exp.declarations.every(d => d.isTypeOnly || d.parent?.parent?.isTypeOnly)) continue;
                const resolved = resolve(exp), ids = resolved && symbolIds.get(resolved), name = prefix + exp.name;
                if (ids?.size === 1) add(boundary, [...ids][0], 'entry', sf, sf);
                if (resolved && (resolved.flags & ts.SymbolFlags.Module)) walk(resolved, name + '.');
            }
        }
        walk(moduleSymbol, '');
    }
}
process.stdout.write(JSON.stringify({ available: true, matched: functionIds.size, edges: [...edges.values()] }));
