import { describe, expect, it } from 'vitest';
import { computeTopologyLayers, computeLayerCount } from './index.js';

describe('topology', () => {
  describe('computeTopologyLayers', () => {
    it('returns empty result for empty graph', () => {
      const result = computeTopologyLayers([], []);
      expect(result.layerCount).toBe(0);
      expect(result.layerAssignments.size).toBe(0);
      expect(result.hasCycle).toBe(false);
    });

    it('assigns single node to layer 0', () => {
      const nodes = [{ id: 'A' }];
      const result = computeTopologyLayers(nodes, []);
      expect(result.layerCount).toBe(1);
      expect(result.layerAssignments.get('A')).toBe(0);
    });

    it('assigns parallel nodes to same layer', () => {
      const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
      const result = computeTopologyLayers(nodes, []);
      expect(result.layerCount).toBe(1);
      expect(result.layerAssignments.get('A')).toBe(0);
      expect(result.layerAssignments.get('B')).toBe(0);
      expect(result.layerAssignments.get('C')).toBe(0);
    });

    it('assigns sequential nodes to successive layers', () => {
      const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.layerCount).toBe(3);
      expect(result.layerAssignments.get('A')).toBe(0);
      expect(result.layerAssignments.get('B')).toBe(1);
      expect(result.layerAssignments.get('C')).toBe(2);
    });

    it('handles diamond dependency correctly', () => {
      // A -> B -> D
      // A -> C -> D
      const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.layerCount).toBe(3);
      expect(result.layerAssignments.get('A')).toBe(0);
      expect(result.layerAssignments.get('B')).toBe(1);
      expect(result.layerAssignments.get('C')).toBe(1);
      expect(result.layerAssignments.get('D')).toBe(2);
    });

    it('handles complex multi-layer graph', () => {
      // Layer 0: A
      // Layer 1: B, C
      // Layer 2: D (depends on both B and C)
      // Layer 3: E (depends on D)
      const nodes = [
        { id: 'A' },
        { id: 'B' },
        { id: 'C' },
        { id: 'D' },
        { id: 'E' },
      ];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
        { from: 'D', to: 'E' },
      ];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.layerCount).toBe(4);
      expect(result.layerAssignments.get('A')).toBe(0);
      expect(result.layerAssignments.get('B')).toBe(1);
      expect(result.layerAssignments.get('C')).toBe(1);
      expect(result.layerAssignments.get('D')).toBe(2);
      expect(result.layerAssignments.get('E')).toBe(3);
    });

    it('ignores edges to unknown nodes', () => {
      const nodes = [{ id: 'A' }, { id: 'B' }];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'Unknown' }, // Unknown node
        { from: 'Unknown', to: 'B' }, // Unknown source
      ];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.layerCount).toBe(2);
      expect(result.layerAssignments.get('A')).toBe(0);
      expect(result.layerAssignments.get('B')).toBe(1);
    });

    it('handles disconnected subgraphs', () => {
      const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'X' }, { id: 'Y' }];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'X', to: 'Y' },
      ];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.layerCount).toBe(2);
      expect(result.layerAssignments.get('A')).toBe(0);
      expect(result.layerAssignments.get('B')).toBe(1);
      expect(result.layerAssignments.get('X')).toBe(0);
      expect(result.layerAssignments.get('Y')).toBe(1);
    });

    it('handles mixed disconnected and connected nodes', () => {
      const nodes = [
        { id: 'A' },
        { id: 'B' },
        { id: 'C' }, // Isolated
      ];
      const edges = [{ from: 'A', to: 'B' }];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.layerCount).toBe(2);
      expect(result.layerAssignments.get('A')).toBe(0);
      expect(result.layerAssignments.get('B')).toBe(1);
      expect(result.layerAssignments.get('C')).toBe(0); // Isolated nodes go to layer 0
      expect(result.hasCycle).toBe(false);
    });

    it('detects simple two-node cycle', () => {
      const nodes = [{ id: 'A' }, { id: 'B' }];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.hasCycle).toBe(true);
      // Cycle nodes are assigned to layer 0 for visualization
      expect(result.layerAssignments.has('A')).toBe(true);
      expect(result.layerAssignments.has('B')).toBe(true);
    });

    it('detects self-loop cycle', () => {
      const nodes = [{ id: 'A' }];
      const edges = [{ from: 'A', to: 'A' }];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.hasCycle).toBe(true);
    });

    it('detects cycle in larger graph', () => {
      // A -> B -> C -> D -> B (cycle at B-C-D)
      const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
        { from: 'C', to: 'D' },
        { from: 'D', to: 'B' }, // Creates cycle
      ];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.hasCycle).toBe(true);
    });

    it('reports no cycle for valid DAG', () => {
      const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ];
      const result = computeTopologyLayers(nodes, edges);
      expect(result.hasCycle).toBe(false);
    });
  });

  describe('computeLayerCount', () => {
    it('returns 0 for empty graph', () => {
      expect(computeLayerCount([], [])).toBe(0);
    });

    it('returns 1 for single node', () => {
      expect(computeLayerCount([{ id: 'A' }], [])).toBe(1);
    });

    it('returns correct count for chain', () => {
      const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
      const edges = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ];
      expect(computeLayerCount(nodes, edges)).toBe(3);
    });
  });
});
