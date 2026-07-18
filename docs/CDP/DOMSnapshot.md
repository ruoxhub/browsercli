# DOMSnapshot

`🧪 Experimental`

This domain facilitates obtaining document snapshots with DOM, layout, and style information.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [CSS](CSS.md), [DOM](DOM.md), [DOMDebugger](DOMDebugger.md), [Page](Page.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="domnode"></a>DOMNode

A Node in the DOM tree.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeType` | `integer` | `Node`'s nodeType. |
| `nodeName` | `string` | `Node`'s nodeName. |
| `nodeValue` | `string` | `Node`'s nodeValue. |
| `textValue`<br/>_optional_ | `string` | Only set for textarea elements, contains the text value. |
| `inputValue`<br/>_optional_ | `string` | Only set for input elements, contains the input's associated text value. |
| `inputChecked`<br/>_optional_ | `boolean` | Only set for radio and checkbox input elements, indicates if the element has been checked |
| `optionSelected`<br/>_optional_ | `boolean` | Only set for option elements, indicates if the element has been selected |
| `backendNodeId` | [DOM.BackendNodeId](DOM.md#backendnodeid) | `Node`'s id, corresponds to DOM.Node.backendNodeId. |
| `childNodeIndexes`<br/>_optional_ | array of `integer` | The indexes of the node's child nodes in the `domNodes` array returned by `getSnapshot`, if<br/>any. |
| `attributes`<br/>_optional_ | array of [NameValue](#namevalue) | Attributes of an `Element` node. |
| `pseudoElementIndexes`<br/>_optional_ | array of `integer` | Indexes of pseudo elements associated with this node in the `domNodes` array returned by<br/>`getSnapshot`, if any. |
| `layoutNodeIndex`<br/>_optional_ | `integer` | The index of the node's related layout tree node in the `layoutTreeNodes` array returned by<br/>`getSnapshot`, if any. |
| `documentURL`<br/>_optional_ | `string` | Document URL that `Document` or `FrameOwner` node points to. |
| `baseURL`<br/>_optional_ | `string` | Base URL that `Document` or `FrameOwner` node uses for URL completion. |
| `contentLanguage`<br/>_optional_ | `string` | Only set for documents, contains the document's content language. |
| `documentEncoding`<br/>_optional_ | `string` | Only set for documents, contains the document's character set encoding. |
| `publicId`<br/>_optional_ | `string` | `DocumentType` node's publicId. |
| `systemId`<br/>_optional_ | `string` | `DocumentType` node's systemId. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | Frame ID for frame owner elements and also for the document node. |
| `contentDocumentIndex`<br/>_optional_ | `integer` | The index of a frame owner element's content document in the `domNodes` array returned by<br/>`getSnapshot`, if any. |
| `pseudoType`<br/>_optional_ | [DOM.PseudoType](DOM.md#pseudotype) | Type of a pseudo element node. |
| `shadowRootType`<br/>_optional_ | [DOM.ShadowRootType](DOM.md#shadowroottype) | Shadow root type. |
| `isClickable`<br/>_optional_ | `boolean` | Whether this DOM node responds to mouse clicks. This includes nodes that have had click<br/>event listeners attached via JavaScript as well as anchor tags that naturally navigate when<br/>clicked. |
| `eventListeners`<br/>_optional_ | array of [DOMDebugger.EventListener](DOMDebugger.md#eventlistener) | Details of the node's event listeners, if any. |
| `currentSourceURL`<br/>_optional_ | `string` | The selected url for nodes with a srcset attribute. |
| `originURL`<br/>_optional_ | `string` | The url of the script (if any) that generates this node. |
| `scrollOffsetX`<br/>_optional_ | `number` | Scroll offsets, set when this node is a Document. |
| `scrollOffsetY`<br/>_optional_ | `number` |  |


### <a name="inlinetextbox"></a>InlineTextBox

Details of post layout rendered text positions. The exact layout should not be regarded as
stable and may change between versions.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `boundingBox` | [DOM.Rect](DOM.md#rect) | The bounding box in document coordinates. Note that scroll offset of the document is ignored. |
| `startCharacterIndex` | `integer` | The starting index in characters, for this post layout textbox substring. Characters that<br/>would be represented as a surrogate pair in UTF-16 have length 2. |
| `numCharacters` | `integer` | The number of characters in this post layout textbox substring. Characters that would be<br/>represented as a surrogate pair in UTF-16 have length 2. |


### <a name="layouttreenode"></a>LayoutTreeNode

Details of an element in the DOM tree with a LayoutObject.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `domNodeIndex` | `integer` | The index of the related DOM node in the `domNodes` array returned by `getSnapshot`. |
| `boundingBox` | [DOM.Rect](DOM.md#rect) | The bounding box in document coordinates. Note that scroll offset of the document is ignored. |
| `layoutText`<br/>_optional_ | `string` | Contents of the LayoutText, if any. |
| `inlineTextNodes`<br/>_optional_ | array of [InlineTextBox](#inlinetextbox) | The post-layout inline text nodes, if any. |
| `styleIndex`<br/>_optional_ | `integer` | Index into the `computedStyles` array returned by `getSnapshot`. |
| `paintOrder`<br/>_optional_ | `integer` | Global paint order index, which is determined by the stacking order of the nodes. Nodes<br/>that are painted together will have the same index. Only provided if includePaintOrder in<br/>getSnapshot was true. |
| `isStackingContext`<br/>_optional_ | `boolean` | Set to true to indicate the element begins a new stacking context. |


### <a name="computedstyle"></a>ComputedStyle

A subset of the full ComputedStyle as defined by the request whitelist.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `properties` | array of [NameValue](#namevalue) | Name/value pairs of computed style properties. |


### <a name="namevalue"></a>NameValue

A name/value pair.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Attribute/property name. |
| `value` | `string` | Attribute/property value. |


### <a name="stringindex"></a>StringIndex

Index of the string in the strings table.

* **Type**: `integer`

### <a name="arrayofstrings"></a>ArrayOfStrings

Index of the string in the strings table.

* **Type**: `array`

### <a name="rarestringdata"></a>RareStringData

Data that is only present on rare nodes.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `index` | array of `integer` |  |
| `value` | array of [StringIndex](#stringindex) |  |


### <a name="rarebooleandata"></a>RareBooleanData

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `index` | array of `integer` |  |


### <a name="rareintegerdata"></a>RareIntegerData

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `index` | array of `integer` |  |
| `value` | array of `integer` |  |


### <a name="rectangle"></a>Rectangle

* **Type**: `array`

### <a name="documentsnapshot"></a>DocumentSnapshot

Document snapshot.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `documentURL` | [StringIndex](#stringindex) | Document URL that `Document` or `FrameOwner` node points to. |
| `title` | [StringIndex](#stringindex) | Document title. |
| `baseURL` | [StringIndex](#stringindex) | Base URL that `Document` or `FrameOwner` node uses for URL completion. |
| `contentLanguage` | [StringIndex](#stringindex) | Contains the document's content language. |
| `encodingName` | [StringIndex](#stringindex) | Contains the document's character set encoding. |
| `publicId` | [StringIndex](#stringindex) | `DocumentType` node's publicId. |
| `systemId` | [StringIndex](#stringindex) | `DocumentType` node's systemId. |
| `frameId` | [StringIndex](#stringindex) | Frame ID for frame owner elements and also for the document node. |
| `nodes` | [NodeTreeSnapshot](#nodetreesnapshot) | A table with dom nodes. |
| `layout` | [LayoutTreeSnapshot](#layouttreesnapshot) | The nodes in the layout tree. |
| `textBoxes` | [TextBoxSnapshot](#textboxsnapshot) | The post-layout inline text nodes. |
| `scrollOffsetX`<br/>_optional_ | `number` | Horizontal scroll offset. |
| `scrollOffsetY`<br/>_optional_ | `number` | Vertical scroll offset. |
| `contentWidth`<br/>_optional_ | `number` | Document content width. |
| `contentHeight`<br/>_optional_ | `number` | Document content height. |


### <a name="nodetreesnapshot"></a>NodeTreeSnapshot

Table containing nodes.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `parentIndex`<br/>_optional_ | array of `integer` | Parent node index. |
| `nodeType`<br/>_optional_ | array of `integer` | `Node`'s nodeType. |
| `shadowRootType`<br/>_optional_ | [RareStringData](#rarestringdata) | Type of the shadow root the `Node` is in. String values are equal to the `ShadowRootType` enum. |
| `nodeName`<br/>_optional_ | array of [StringIndex](#stringindex) | `Node`'s nodeName. |
| `nodeValue`<br/>_optional_ | array of [StringIndex](#stringindex) | `Node`'s nodeValue. |
| `backendNodeId`<br/>_optional_ | array of [DOM.BackendNodeId](DOM.md#backendnodeid) | `Node`'s id, corresponds to DOM.Node.backendNodeId. |
| `attributes`<br/>_optional_ | array of [ArrayOfStrings](#arrayofstrings) | Attributes of an `Element` node. Flatten name, value pairs. |
| `textValue`<br/>_optional_ | [RareStringData](#rarestringdata) | Only set for textarea elements, contains the text value. |
| `inputValue`<br/>_optional_ | [RareStringData](#rarestringdata) | Only set for input elements, contains the input's associated text value. |
| `inputChecked`<br/>_optional_ | [RareBooleanData](#rarebooleandata) | Only set for radio and checkbox input elements, indicates if the element has been checked |
| `optionSelected`<br/>_optional_ | [RareBooleanData](#rarebooleandata) | Only set for option elements, indicates if the element has been selected |
| `contentDocumentIndex`<br/>_optional_ | [RareIntegerData](#rareintegerdata) | The index of the document in the list of the snapshot documents. |
| `pseudoType`<br/>_optional_ | [RareStringData](#rarestringdata) | Type of a pseudo element node. |
| `pseudoIdentifier`<br/>_optional_ | [RareStringData](#rarestringdata) | Pseudo element identifier for this node. Only present if there is a<br/>valid pseudoType. |
| `isClickable`<br/>_optional_ | [RareBooleanData](#rarebooleandata) | Whether this DOM node responds to mouse clicks. This includes nodes that have had click<br/>event listeners attached via JavaScript as well as anchor tags that naturally navigate when<br/>clicked. |
| `currentSourceURL`<br/>_optional_ | [RareStringData](#rarestringdata) | The selected url for nodes with a srcset attribute. |
| `originURL`<br/>_optional_ | [RareStringData](#rarestringdata) | The url of the script (if any) that generates this node. |


### <a name="layouttreesnapshot"></a>LayoutTreeSnapshot

Table of details of an element in the DOM tree with a LayoutObject.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIndex` | array of `integer` | Index of the corresponding node in the `NodeTreeSnapshot` array returned by `captureSnapshot`. |
| `styles` | array of [ArrayOfStrings](#arrayofstrings) | Array of indexes specifying computed style strings, filtered according to the `computedStyles` parameter passed to `captureSnapshot`. |
| `bounds` | array of [Rectangle](#rectangle) | The absolute position bounding box. |
| `text` | array of [StringIndex](#stringindex) | Contents of the LayoutText, if any. |
| `stackingContexts` | [RareBooleanData](#rarebooleandata) | Stacking context information. |
| `paintOrders`<br/>_optional_ | array of `integer` | Global paint order index, which is determined by the stacking order of the nodes. Nodes<br/>that are painted together will have the same index. Only provided if includePaintOrder in<br/>captureSnapshot was true. |
| `offsetRects`<br/>_optional_ | array of [Rectangle](#rectangle) | The offset rect of nodes. Only available when includeDOMRects is set to true |
| `scrollRects`<br/>_optional_ | array of [Rectangle](#rectangle) | The scroll rect of nodes. Only available when includeDOMRects is set to true |
| `clientRects`<br/>_optional_ | array of [Rectangle](#rectangle) | The client rect of nodes. Only available when includeDOMRects is set to true |
| `blendedBackgroundColors`<br/>_optional_ | array of [StringIndex](#stringindex) | `🧪 experimental` The list of background colors that are blended with colors of overlapping elements. |
| `textColorOpacities`<br/>_optional_ | array of `number` | `🧪 experimental` The list of computed text opacities. |


### <a name="textboxsnapshot"></a>TextBoxSnapshot

Table of details of the post layout rendered text positions. The exact layout should not be regarded as
stable and may change between versions.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `layoutIndex` | array of `integer` | Index of the layout tree node that owns this box collection. |
| `bounds` | array of [Rectangle](#rectangle) | The absolute position bounding box. |
| `start` | array of `integer` | The starting index in characters, for this post layout textbox substring. Characters that<br/>would be represented as a surrogate pair in UTF-16 have length 2. |
| `length` | array of `integer` | The number of characters in this post layout textbox substring. Characters that would be<br/>represented as a surrogate pair in UTF-16 have length 2. |


---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

Disables DOM snapshot agent for the given page.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables DOM snapshot agent for the given page.

* **Parameters**: None

* **Returns**: None


### <a name="getsnapshot"></a>getSnapshot `⚠️ deprecated`

Returns a document snapshot, including the full DOM tree of the root node (including iframes,
template contents, and imported documents) in a flattened array, as well as layout and
white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
flattened.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `computedStyleWhitelist` | array of `string` | Whitelist of computed styles to return. |
| `includeEventListeners`<br/>_optional_ | `boolean` | Whether or not to retrieve details of DOM listeners (default false). |
| `includePaintOrder`<br/>_optional_ | `boolean` | Whether to determine and include the paint order index of LayoutTreeNodes (default false). |
| `includeUserAgentShadowTree`<br/>_optional_ | `boolean` | Whether to include UA shadow tree in the snapshot (default false). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `domNodes` | array of [DOMNode](#domnode) | The nodes in the DOM tree. The DOMNode at index 0 corresponds to the root document. |
| `layoutTreeNodes` | array of [LayoutTreeNode](#layouttreenode) | The nodes in the layout tree. |
| `computedStyles` | array of [ComputedStyle](#computedstyle) | Whitelisted ComputedStyle properties for each node in the layout tree. |


### <a name="capturesnapshot"></a>captureSnapshot

Returns a document snapshot, including the full DOM tree of the root node (including iframes,
template contents, and imported documents) in a flattened array, as well as layout and
white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
flattened.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `computedStyles` | array of `string` | Whitelist of computed styles to return. |
| `includePaintOrder`<br/>_optional_ | `boolean` | Whether to include layout object paint orders into the snapshot. |
| `includeDOMRects`<br/>_optional_ | `boolean` | Whether to include DOM rectangles (offsetRects, clientRects, scrollRects) into the snapshot |
| `includeBlendedBackgroundColors`<br/>_optional_ | `boolean` | `🧪 experimental` Whether to include blended background colors in the snapshot (default: false).<br/>Blended background color is achieved by blending background colors of all elements<br/>that overlap with the current element. |
| `includeTextColorOpacities`<br/>_optional_ | `boolean` | `🧪 experimental` Whether to include text color opacity in the snapshot (default: false).<br/>An element might have the opacity property set that affects the text color of the element.<br/>The final text color opacity is computed based on the opacity of all overlapping elements. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `documents` | array of [DocumentSnapshot](#documentsnapshot) | The nodes in the DOM tree. The DOMNode at index 0 corresponds to the root document. |
| `strings` | array of `string` | Shared string table that all string properties refer to with indexes. |


---

<a name="events"></a>
## Events

_None_

