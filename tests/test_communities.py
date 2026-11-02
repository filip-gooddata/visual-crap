import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from community_layout import layout_communities

class CommunityLayoutTest(unittest.TestCase):
    def test_dense_groups_remain_distinct_across_a_single_bridge(self):
        nodes = [{'path': f'src/group{i // 6}/f{i}.ts'} for i in range(12)]
        edges = [[i, j, 'call', ''] for start in (0, 6) for i in range(start, start + 6) for j in range(i + 1, start + 6)]
        edges.append([5, 6, 'call', ''])
        result, centers = layout_communities(nodes, edges, 'src')
        self.assertEqual(len(set(result[:6])), 1)
        self.assertEqual(len(set(result[6:])), 1)
        self.assertNotEqual(result[0], result[6])
        self.assertEqual((result, centers), layout_communities(nodes, edges, 'src'))

    def test_disconnected_nodes_are_packed_by_directory(self):
        nodes = [{'path': 'src/a/one.ts'}, {'path': 'src/a/two.ts'}, {'path': 'src/b/three.ts'}]
        result, centers = layout_communities(nodes, [], 'src')
        self.assertEqual(result[0], result[1])
        self.assertNotEqual(result[0], result[2])

if __name__ == '__main__':
    unittest.main()
