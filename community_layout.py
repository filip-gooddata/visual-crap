"""Assign deterministic layout communities to retained static relationships."""
import math
from collections import defaultdict
import networkx as nx
import numpy as np

# These are visual weights, not probabilities or assertions about runtime calls.
RELATIONSHIP_WEIGHTS = {'call': 1.0, 'construct': 1.0, 'render': 1.0,
                        'inferred': 0.35, 'passed': 0.15, 'prop': 0.15,
                        'configured': 0.15, 'returned': 0.15, 'default': 0.15, 'entry': 0.04}

def layout_communities(nodes, edges, source_root="."):
    """Cluster weighted edges; pack tiny communities by source directory."""
    neighbors = defaultdict(set)
    for a, b, *_ in edges:
        if a != b:
            neighbors[a].add(b)
            neighbors[b].add(a)
    graph = nx.Graph()
    graph.add_nodes_from(range(len(nodes)))
    for a, b, kind, *_ in edges:
        if a == b:
            continue
        degree = max(len(neighbors[a]), len(neighbors[b]))
        weight = RELATIONSHIP_WEIGHTS.get(kind, 0.15) / math.sqrt(max(1, degree / 4))
        if graph.has_edge(a, b):
            graph[a][b]['weight'] = max(graph[a][b]['weight'], weight)
        else:
            graph.add_edge(a, b, weight=weight)
    communities = nx.community.louvain_communities(graph, weight='weight', seed=7) if graph.number_of_edges() else [{i} for i in graph]
    minimum_size = max(4, min(30, len(nodes) // 100))
    large = [sorted(c) for c in communities if len(c) >= minimum_size]
    small = defaultdict(list)
    for community in communities:
        if len(community) < minimum_size:
            # Keep tiny disconnected components together in a source-directory region.
            representative = min(community)
            path = nodes[representative]['path']
            prefix = '' if source_root == '.' else source_root.rstrip('/') + '/'
            relative = path[len(prefix):] if path.startswith(prefix) else path
            parts = relative.split('/')
            directory = '/'.join(parts[:2]) if parts[0] == 'features' else parts[0]
            small[directory].extend(community)
    groups = large + [sorted(items) for _, items in sorted(small.items())]
    groups.sort(key=lambda group: (-len(group), group[0]))
    assignment = [0] * len(nodes)
    for group_id, group in enumerate(groups):
        for node in group:
            assignment[node] = group_id
    # Arrange the communities using their real cross-community relationships.
    # This is an initial placement only; it does not create report edges.
    coarse = nx.Graph()
    coarse.add_nodes_from(range(len(groups)))
    for a, b, values in graph.edges(data=True):
        x, y = assignment[a], assignment[b]
        if x == y:
            continue
        weight = values['weight']
        if coarse.has_edge(x, y):
            coarse[x][y]['weight'] += weight
        else:
            coarse.add_edge(x, y, weight=weight)
    for _, _, values in coarse.edges(data=True):
        values['weight'] = math.log1p(values['weight'])
    centers = nx.spring_layout(coarse, k=0.7, weight='weight', seed=7, iterations=120, scale=700)
    # Spread overlapping seeded regions without changing the graph or its edges.
    # The small tether retains the coarse layout's broad relationship structure.
    points = np.array([centers[i] for i in range(len(groups))], dtype=float)
    origins = points.copy()
    radii = np.array([5 * math.sqrt(len(group)) + 55 for group in groups])
    for _ in range(160):
        delta = points[:, None, :] - points[None, :, :]
        distance = np.maximum(np.linalg.norm(delta, axis=2), 1e-6)
        overlap = np.maximum(0, radii[:, None] + radii[None, :] - distance)
        np.fill_diagonal(overlap, 0)
        offsets = (delta / distance[:, :, None] * overlap[:, :, None]).sum(axis=1)
        count = np.maximum(1, (overlap > 0).sum(axis=1))[:, None]
        points += 0.4 * offsets / count + 0.002 * (origins - points)
    return assignment, points.tolist()
