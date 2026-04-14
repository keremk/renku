/**
 * Shared type definitions for the viewer API.
 * These types are used across blueprints, builds, and movies modules.
 */

/**
 * Blueprint graph data for visualization.
 */
export interface BlueprintGraphData {
  meta: {
    id: string;
    name: string;
    description?: string;
    version?: string;
  };
  nodes: BlueprintGraphNode[];
  edges: BlueprintGraphEdge[];
  inputs: BlueprintInputDef[];
  outputs: BlueprintOutputDef[];
  conditions?: ConditionDef[];
  /** Pre-computed layer assignments for producer nodes (nodeId -> layer index) */
  layerAssignments?: Record<string, number>;
  /** Total number of layers in the blueprint topology */
  layerCount?: number;
  /** Loop-indexed grouped input metadata for paged input editing */
  loopGroups?: BlueprintLoopGroup[];
  /** Count inputs that are managed by grouped loop controls */
  managedCountInputs?: string[];
}

/**
 * Graph node representing inputs, producers, or outputs.
 */
export interface BlueprintGraphNode {
  id: string;
  type: 'input' | 'producer' | 'output';
  label: string;
  loop?: string;
  runnable?: boolean;
  producerType?: string;
  description?: string;
  inputBindings?: ProducerBinding[];
  outputBindings?: ProducerBinding[];
}

/**
 * Graph edge connecting nodes.
 */
export interface BlueprintGraphEdge {
  id: string;
  source: string;
  target: string;
  conditionName?: string;
  isConditional?: boolean;
}

export type SystemInputKind = 'user' | 'derived' | 'runtime';

export interface BlueprintInputSystemMeta {
  kind: SystemInputKind;
  userSupplied: boolean;
  source: 'declared' | 'synthetic';
}

/**
 * Blueprint input definition for graph display.
 */
export interface BlueprintInputDef {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  itemType?: string;
  countInput?: string;
  system?: BlueprintInputSystemMeta;
}

/**
 * Blueprint output definition for graph display.
 */
export interface BlueprintOutputDef {
  name: string;
  type: string;
  description?: string;
  itemType?: string;
}

/**
 * Named condition definition.
 */
export interface ConditionDef {
  name: string;
  definition: unknown;
}

export type BindingEndpointType = 'input' | 'producer' | 'output' | 'unknown';

export type BindingSelector =
  | {
      kind: 'loop';
      raw: string;
      symbol: string;
      offset: number;
    }
  | {
      kind: 'const';
      raw: string;
      value: number;
    };

export interface BindingEndpointSegment {
  name: string;
  selectors: BindingSelector[];
}

export interface ProducerBindingEndpoint {
  kind: Exclude<BindingEndpointType, 'unknown'>;
  reference: string;
  producerName?: string;
  inputName?: string;
  outputName?: string;
  segments: BindingEndpointSegment[];
  loopSelectors: Array<Extract<BindingSelector, { kind: 'loop' }>>;
  constantSelectors: Array<Extract<BindingSelector, { kind: 'const' }>>;
  arraySelectors: Array<{
    segment: string;
    segmentIndex: number;
    selector: BindingSelector;
  }>;
}

export interface ProducerBinding {
  from: string;
  to: string;
  sourceType: BindingEndpointType;
  targetType: BindingEndpointType;
  sourceEndpoint?: ProducerBindingEndpoint;
  targetEndpoint?: ProducerBindingEndpoint;
  conditionName?: string;
  isConditional: boolean;
}

export interface BlueprintLoopGroupMember {
  inputName: string;
}

export interface BlueprintLoopGroup {
  groupId: string;
  primaryDimension: string;
  countInput: string;
  countInputOffset: number;
  members: BlueprintLoopGroupMember[];
}
