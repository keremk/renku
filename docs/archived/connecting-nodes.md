# TOML Based Configuration
- There are 2 types of TOML files
    - Defines a sub blueprint with their inputs, outputs, producers and a graph with edge definition. 
    - Defines how the sub blueprints connect to each other for composition.
- Refer to the `cli/docs/generation-diagram.png` file for a graphical representation of the `catalog/blueprints/image-only.toml` sample blueprint and the sub blueprints it refers to: `image-generate.toml`, `image-prompt-generate.toml`, and `script-generate.toml` 
> Note the other TOML files still using the old format so only refer to the above mentioned ones

## Changes from the previous implementation
- We are making sure that definitions are dry and removing duplicate definitions
    - Removings `nodes` property from the [graph] table. Now all 3 node types are identified as:
        - [[inputs]] -> Corresponds to the entry into the blueprint (node type Input)
        - [[artefacts]] -> Corresponds to the output Artefacts from the blueprint (node type Artefact)
        - [[producers]] -> Corresponds to the the producers for the blueprint (node type Producer)
    - [[subBlueprints]] -> Refers to other TOML files that defines the blueprints, They are a way of grouping nodes into a subgraph. They are identified by their name.
    - Keeping the `edges` property of the [graph] table. But removing the `perSegment=true` markers. For brevity, edges refer to nodes only by their Namespace.Name and not including the type of the node, since that is already stated in the above sections.
> Previously we defined some inputs as array (cardinality=perSegment) which was very confusing. Yes there will be multiple instances but each instance has a single input, so this definition did not really match the reality.
- Each subBlueprint defines a namespace. E.g. ImageGenerator.Size is the name of the node with this nodeId: "Input:ImageGenerator.Size"
- The cardinality is reflected in the ID of the node with index notations. E.g. ImagePromptGenerator[i].ImagePrompt[j] denotes the i'th instance of the ImagePromptGenerator with the j'th instance of ImagePrompt. This way once the expansion is complete we have a very deterministic way addressing every node. Also important for the logs and locating the Artefacts across the system.
- Once the TOML files loaded and parsed, we are proposing to use a different algorithm to figure out the cardinality in order to correctly expand the definitions into the fully expanded graph.
    - E.g.(1): { from = "ScriptGenerator.NarrationScript[i]", to = "ImagePromptGenerator[i].NarrativeText" }
        - In ScriptGenerator blueprint, NarrationScript was defined as an array type indicating that it was a 1:many relationship. I.e. Producer producing many NarrationScript artefacts.
        - We denote the connection (edge) with an index NarrationScript[i] on the `from` side of the edge.
        - The `to` side indicates there should now be n instances of ImagePromptGenerator[i].NarrativeText input nodes. So this should indicate that now we need to fanout ImagePromptGenerator instances, when expanding the graph (see below for collapsing the input and artefact nodes into one artefact node after expansion for a direct connection)
        > There should be no "input" nodes between an "artefact" and "producer". I.e. this is an illegal graph: producer -> artefact -> input -> producer. It should always be producer -> artefact ->producer 
    - E.g. (2): { from = "ImagePromptGenerator[i].ImagePrompt[j]", to = "ImageGenerator[i][j].Prompt" }
        - In ImagePromptGenerator blueprint, ImagePrompt was defined as an array type indicating that it was a 1:many relationship. 
        - However in this case in the expanded graph, ImagePromptGenerator itself was also n instances denoted by the indice ImagePromptGenerator[i]
        - To differentiate the indices we used another letter j to denote the multiplicity of ImagePrompt.
        - Then the algorithm should infer that in the expanded graph, we will have i*j instances (multidimensional array), and that requires ImageGenerator[i][j].Prompt. (See below again for collapsing the input and artefact types into one artefact type)
    - E.g. (3): { from = "ScriptGenerator.MovieSummary", to = "ImagePromptGenerator[i].OverallSummary" }
        - In this case, there is a 1:many relationship. ScriptGenerator generated only one artefact ScriptGenerator.MovieSummary. 
        - This should be denoted as a single node that connects to all instances of the ImagePromptGenerator[i].OverallSummary nodes. (See below again for collapsing the two into one ScriptGenerator.MovieSummary)
- Node naming must be unified. It follows this structure: NodeType:BlueprintNamespace.Name
    - There are only 3 types of nodes: Input, Producer, Artefact. 
- Once two subBlueprints are connected, the input of the Connecting Blueprint takes the node type and name of Connected Blueprint. This ensures that the artefacts that are created can always be located with a single ID. It also captures where it was exactly created in the graph accurately and easy to debug.
    -E.g.(1) { from = "ScriptGenerator.NarrationScript[i]", to = "ImagePromptGenerator[i].NarrativeText" }
        - ScriptGenerator.NarrationScript[i] is an Artefact type node
        - ImagePromptGenerator[i].NarrativeText is an Input type node
        - They merge into a single node in the expanded graph with the nodeId="Artefact:ScriptGenerator.NarrationScript[i]"
    -E.g.(2) { from = "InquiryPrompt", to = "ScriptGenerator.InquiryPrompt" }
        - InquiryPrompt is an Input type node
        - ScriptGenerator.InquiryPrompt is also an Input type node
        - They merge into a single node in the expanded graph with the nodeId="Input:InquiryPrompt"
    -E.g.(3) { from = "ImageGenerator[i][j].SegmentImage", to = "SegmentImage[i][j]"}
        - ImageGenerator[i][j].SegmentImage is an Artefact type node.
        - SegmentImage[i][j] is an Artefact type node.
        - They merge into a single node in the expanded graph with the nodeId="Artefact:ImageGenerator[i][j].SegmentImage
    -E.g.(4) { from = "ImagePromptGenerator[i].ImagePrompt[j]", to = "ImageGenerator[i][j].Prompt" }
        - ImagePromptGenerator[i].ImagePrompt[j] is an Artefact type node.
        - ImageGenerator[i][j].Prompt is an Input type node.
        - They merge into a single node in the expanded graph with the nodeId="Artefact:ImagePromptGenerator[i].ImagePrompt[j]"
- We have been also having problems identifying the inputs to the producer implementations in the providers package. Currently there are many ways of naming things. We will have one and only one way of naming nodes (artefacts, inputs, producers)
    - Depending on how the graph is expanded (including cardinalities and the namespacing from sub blueprints), the final id of the artefacts and inputs may change.
    - We need to be able to dynamically map:
        - E.g. (1): Artefact:ImagePromptGenerator[i].ImagePrompt[j] to prompt (replicate API schema), That is how the prompt is saved in the blobs and recorded in the artefacts.log. 
            - Use the [[producers.sdkMapping]] table in the TOML to map the graph nodes to the SDK expected schema value (identified as fields)
            - When the graph is expanded ImageGenerator[i][j].Prompt was collapsed into ImagePromptGenerator[i].ImagePrompt[j]. So replace the Prompt in the mapping with the actual nodeId = "Artefact:ImagePromptGenerator[i].ImagePrompt[j]"
    - Remove all the convoluted lookups in the producers codebase and substitute with a pre-computed (during expansion) universal nodeId. Then in runtime, the producer will simply look up that input or artefact type node. 
