# Runtime

Runtime domain exposes JavaScript runtime by means of remote evaluation and mirror objects.
Evaluation results are returned as mirror object that expose object type, string representation
and unique identifier that can be used for further object reference. Original objects are
maintained in memory unless they are either explicitly released or are released along with the
other objects in their object group.

* **Source**: JS Protocol (V8)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="scriptid"></a>ScriptId

Unique script identifier.

* **Type**: `string`

### <a name="serializationoptions"></a>SerializationOptions

Represents options for serialization. Overrides `generatePreview` and `returnByValue`.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `serialization` | `string` | Allowed values: `"deep"`, `"json"`, `"idOnly"` |
| `maxDepth`<br/>_optional_ | `integer` | Deep serialization depth. Default is full depth. Respected only in `deep` serialization mode. |
| `additionalParameters`<br/>_optional_ | `object` | Embedder-specific parameters. For example if connected to V8 in Chrome these control DOM<br/>serialization via `maxNodeDepth: integer` and `includeShadowTree: "none" \| "open" \| "all"`.<br/>Values can be only of type string or integer. |


### <a name="deepserializedvalue"></a>DeepSerializedValue

Represents deep serialized value.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Allowed values: `"undefined"`, `"null"`, `"string"`, `"number"`, `"boolean"`, `"bigint"`, `"regexp"`, `"date"`, `"symbol"`, `"array"`, `"object"`, `"function"`, `"map"`, `"set"`, `"weakmap"`, `"weakset"`, `"error"`, `"proxy"`, `"promise"`, `"typedarray"`, `"arraybuffer"`, `"node"`, `"window"`, `"generator"` |
| `value`<br/>_optional_ | `any` |  |
| `objectId`<br/>_optional_ | `string` |  |
| `weakLocalObjectReference`<br/>_optional_ | `integer` | Set if value reference met more then once during serialization. In such<br/>case, value is provided only to one of the serialized values. Unique<br/>per value in the scope of one CDP call. |


### <a name="remoteobjectid"></a>RemoteObjectId

Unique object identifier.

* **Type**: `string`

### <a name="unserializablevalue"></a>UnserializableValue

Primitive value which cannot be JSON-stringified. Includes values `-0`, `NaN`, `Infinity`,
`-Infinity`, and bigint literals.

* **Type**: `string`

### <a name="remoteobject"></a>RemoteObject

Mirror object referencing original JavaScript object.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Object type.<br/>Allowed values: `"object"`, `"function"`, `"undefined"`, `"string"`, `"number"`, `"boolean"`, `"symbol"`, `"bigint"` |
| `subtype`<br/>_optional_ | `string` | Object subtype hint. Specified for `object` type values only.<br/>NOTE: If you change anything here, make sure to also update<br/>`subtype` in `ObjectPreview` and `PropertyPreview` below.<br/>Allowed values: `"array"`, `"null"`, `"node"`, `"regexp"`, `"date"`, `"map"`, `"set"`, `"weakmap"`, `"weakset"`, `"iterator"`, `"generator"`, `"error"`, `"proxy"`, `"promise"`, `"typedarray"`, `"arraybuffer"`, `"dataview"`, `"webassemblymemory"`, `"wasmvalue"`, `"trustedtype"` |
| `className`<br/>_optional_ | `string` | Object class (constructor) name. Specified for `object` type values only. |
| `value`<br/>_optional_ | `any` | Remote object value in case of primitive values or JSON values (if it was requested). |
| `unserializableValue`<br/>_optional_ | [UnserializableValue](#unserializablevalue) | Primitive value which can not be JSON-stringified does not have `value`, but gets this<br/>property. |
| `description`<br/>_optional_ | `string` | String representation of the object. |
| `deepSerializedValue`<br/>_optional_ | [DeepSerializedValue](#deepserializedvalue) | `🧪 experimental` Deep serialized value. |
| `objectId`<br/>_optional_ | [RemoteObjectId](#remoteobjectid) | Unique object identifier (for non-primitive values). |
| `preview`<br/>_optional_ | [ObjectPreview](#objectpreview) | `🧪 experimental` Preview containing abbreviated property values. Specified for `object` type values only. |
| `customPreview`<br/>_optional_ | [CustomPreview](#custompreview) | `🧪 experimental` |


### <a name="custompreview"></a>CustomPreview `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `header` | `string` | The JSON-stringified result of formatter.header(object, config) call.<br/>It contains json ML array that represents RemoteObject. |
| `bodyGetterId`<br/>_optional_ | [RemoteObjectId](#remoteobjectid) | If formatter returns true as a result of formatter.hasBody call then bodyGetterId will<br/>contain RemoteObjectId for the function that returns result of formatter.body(object, config) call.<br/>The result value is json ML array. |


### <a name="objectpreview"></a>ObjectPreview `🧪 experimental`

Object containing abbreviated remote object value.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Object type.<br/>Allowed values: `"object"`, `"function"`, `"undefined"`, `"string"`, `"number"`, `"boolean"`, `"symbol"`, `"bigint"` |
| `subtype`<br/>_optional_ | `string` | Object subtype hint. Specified for `object` type values only.<br/>Allowed values: `"array"`, `"null"`, `"node"`, `"regexp"`, `"date"`, `"map"`, `"set"`, `"weakmap"`, `"weakset"`, `"iterator"`, `"generator"`, `"error"`, `"proxy"`, `"promise"`, `"typedarray"`, `"arraybuffer"`, `"dataview"`, `"webassemblymemory"`, `"wasmvalue"`, `"trustedtype"` |
| `description`<br/>_optional_ | `string` | String representation of the object. |
| `overflow` | `boolean` | True iff some of the properties or entries of the original object did not fit. |
| `properties` | array of [PropertyPreview](#propertypreview) | List of the properties. |
| `entries`<br/>_optional_ | array of [EntryPreview](#entrypreview) | List of the entries. Specified for `map` and `set` subtype values only. |


### <a name="propertypreview"></a>PropertyPreview `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Property name. |
| `type` | `string` | Object type. Accessor means that the property itself is an accessor property.<br/>Allowed values: `"object"`, `"function"`, `"undefined"`, `"string"`, `"number"`, `"boolean"`, `"symbol"`, `"accessor"`, `"bigint"` |
| `value`<br/>_optional_ | `string` | User-friendly property value string. |
| `valuePreview`<br/>_optional_ | [ObjectPreview](#objectpreview) | Nested value preview. |
| `subtype`<br/>_optional_ | `string` | Object subtype hint. Specified for `object` type values only.<br/>Allowed values: `"array"`, `"null"`, `"node"`, `"regexp"`, `"date"`, `"map"`, `"set"`, `"weakmap"`, `"weakset"`, `"iterator"`, `"generator"`, `"error"`, `"proxy"`, `"promise"`, `"typedarray"`, `"arraybuffer"`, `"dataview"`, `"webassemblymemory"`, `"wasmvalue"`, `"trustedtype"` |


### <a name="entrypreview"></a>EntryPreview `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `key`<br/>_optional_ | [ObjectPreview](#objectpreview) | Preview of the key. Specified for map-like collection entries. |
| `value` | [ObjectPreview](#objectpreview) | Preview of the value. |


### <a name="propertydescriptor"></a>PropertyDescriptor

Object property descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Property name or symbol description. |
| `value`<br/>_optional_ | [RemoteObject](#remoteobject) | The value associated with the property. |
| `writable`<br/>_optional_ | `boolean` | True if the value associated with the property may be changed (data descriptors only). |
| `get`<br/>_optional_ | [RemoteObject](#remoteobject) | A function which serves as a getter for the property, or `undefined` if there is no getter<br/>(accessor descriptors only). |
| `set`<br/>_optional_ | [RemoteObject](#remoteobject) | A function which serves as a setter for the property, or `undefined` if there is no setter<br/>(accessor descriptors only). |
| `configurable` | `boolean` | True if the type of this property descriptor may be changed and if the property may be<br/>deleted from the corresponding object. |
| `enumerable` | `boolean` | True if this property shows up during enumeration of the properties on the corresponding<br/>object. |
| `wasThrown`<br/>_optional_ | `boolean` | True if the result was thrown during the evaluation. |
| `isOwn`<br/>_optional_ | `boolean` | True if the property is owned for the object. |
| `symbol`<br/>_optional_ | [RemoteObject](#remoteobject) | Property symbol object, if the property is of the `symbol` type. |


### <a name="internalpropertydescriptor"></a>InternalPropertyDescriptor

Object internal property descriptor. This property isn't normally visible in JavaScript code.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Conventional property name. |
| `value`<br/>_optional_ | [RemoteObject](#remoteobject) | The value associated with the property. |


### <a name="privatepropertydescriptor"></a>PrivatePropertyDescriptor `🧪 experimental`

Object private field descriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Private property name. |
| `value`<br/>_optional_ | [RemoteObject](#remoteobject) | The value associated with the private property. |
| `get`<br/>_optional_ | [RemoteObject](#remoteobject) | A function which serves as a getter for the private property,<br/>or `undefined` if there is no getter (accessor descriptors only). |
| `set`<br/>_optional_ | [RemoteObject](#remoteobject) | A function which serves as a setter for the private property,<br/>or `undefined` if there is no setter (accessor descriptors only). |


### <a name="callargument"></a>CallArgument

Represents function call argument. Either remote object id `objectId`, primitive `value`,
unserializable primitive value or neither of (for undefined) them should be specified.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `value`<br/>_optional_ | `any` | Primitive value or serializable javascript object. |
| `unserializableValue`<br/>_optional_ | [UnserializableValue](#unserializablevalue) | Primitive value which can not be JSON-stringified. |
| `objectId`<br/>_optional_ | [RemoteObjectId](#remoteobjectid) | Remote object handle. |


### <a name="executioncontextid"></a>ExecutionContextId

Id of an execution context.

* **Type**: `integer`

### <a name="executioncontextdescription"></a>ExecutionContextDescription

Description of an isolated world.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [ExecutionContextId](#executioncontextid) | Unique id of the execution context. It can be used to specify in which execution context<br/>script evaluation should be performed. |
| `origin` | `string` | Execution context origin. |
| `name` | `string` | Human readable name describing given context. |
| `uniqueId` | `string` | `🧪 experimental` A system-unique execution context identifier. Unlike the id, this is unique across<br/>multiple processes, so can be reliably used to identify specific context while backend<br/>performs a cross-process navigation. |
| `auxData`<br/>_optional_ | `object` | Embedder-specific auxiliary data likely matching {isDefault: boolean, type: 'default'\|'isolated'\|'worker', frameId: string} |


### <a name="exceptiondetails"></a>ExceptionDetails

Detailed information about exception (or error) that was thrown during script compilation or
execution.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `exceptionId` | `integer` | Exception id. |
| `text` | `string` | Exception text, which should be used together with exception object when available. |
| `lineNumber` | `integer` | Line number of the exception location (0-based). |
| `columnNumber` | `integer` | Column number of the exception location (0-based). |
| `scriptId`<br/>_optional_ | [ScriptId](#scriptid) | Script ID of the exception location. |
| `url`<br/>_optional_ | `string` | URL of the exception location, to be used when the script was not reported. |
| `stackTrace`<br/>_optional_ | [StackTrace](#stacktrace) | JavaScript stack trace if available. |
| `exception`<br/>_optional_ | [RemoteObject](#remoteobject) | Exception object if available. |
| `executionContextId`<br/>_optional_ | [ExecutionContextId](#executioncontextid) | Identifier of the context where exception happened. |
| `exceptionMetaData`<br/>_optional_ | `object` | `🧪 experimental` Dictionary with entries of meta data that the client associated<br/>with this exception, such as information about associated network<br/>requests, etc. |


### <a name="timestamp"></a>Timestamp

Number of milliseconds since epoch.

* **Type**: `number`

### <a name="timedelta"></a>TimeDelta

Number of milliseconds.

* **Type**: `number`

### <a name="callframe"></a>CallFrame

Stack entry for runtime errors and assertions.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `functionName` | `string` | JavaScript function name. |
| `scriptId` | [ScriptId](#scriptid) | JavaScript script id. |
| `url` | `string` | JavaScript script name or url. |
| `lineNumber` | `integer` | JavaScript script line number (0-based). |
| `columnNumber` | `integer` | JavaScript script column number (0-based). |


### <a name="stacktrace"></a>StackTrace

Call frames for assertions or error messages.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `description`<br/>_optional_ | `string` | String label of this stack trace. For async traces this may be a name of the function that<br/>initiated the async call. |
| `callFrames` | array of [CallFrame](#callframe) | JavaScript function name. |
| `parent`<br/>_optional_ | [StackTrace](#stacktrace) | Asynchronous JavaScript stack trace that preceded this stack, if available. |
| `parentId`<br/>_optional_ | [StackTraceId](#stacktraceid) | `🧪 experimental` Asynchronous JavaScript stack trace that preceded this stack, if available. |


### <a name="uniquedebuggerid"></a>UniqueDebuggerId `🧪 experimental`

Unique identifier of current debugger.

* **Type**: `string`

### <a name="stacktraceid"></a>StackTraceId `🧪 experimental`

If `debuggerId` is set stack trace comes from another debugger and can be resolved there. This
allows to track cross-debugger calls. See `Runtime.StackTrace` and `Debugger.paused` for usages.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` |  |
| `debuggerId`<br/>_optional_ | [UniqueDebuggerId](#uniquedebuggerid) |  |


---

<a name="commands"></a>
## Commands

### <a name="awaitpromise"></a>awaitPromise

Add handler to promise with given promise object id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `promiseObjectId` | [RemoteObjectId](#remoteobjectid) | Identifier of the promise. |
| `returnByValue`<br/>_optional_ | `boolean` | Whether the result is expected to be a JSON object that should be sent by value. |
| `generatePreview`<br/>_optional_ | `boolean` | Whether preview should be generated for the result. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | [RemoteObject](#remoteobject) | Promise result. Will contain rejected value if promise was rejected. |
| `exceptionDetails`<br/>_optional_ | [ExceptionDetails](#exceptiondetails) | Exception details if stack strace is available. |


### <a name="callfunctionon"></a>callFunctionOn

Calls function with given declaration on the given object. Object group of the result is
inherited from the target object.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `functionDeclaration` | `string` | Declaration of the function to call. |
| `objectId`<br/>_optional_ | [RemoteObjectId](#remoteobjectid) | Identifier of the object to call function on. Either objectId or executionContextId should<br/>be specified. |
| `arguments`<br/>_optional_ | array of [CallArgument](#callargument) | Call arguments. All call arguments must belong to the same JavaScript world as the target<br/>object. |
| `silent`<br/>_optional_ | `boolean` | In silent mode exceptions thrown during evaluation are not reported and do not pause<br/>execution. Overrides `setPauseOnException` state. |
| `returnByValue`<br/>_optional_ | `boolean` | Whether the result is expected to be a JSON object which should be sent by value.<br/>Can be overriden by `serializationOptions`. |
| `generatePreview`<br/>_optional_ | `boolean` | `🧪 experimental` Whether preview should be generated for the result. |
| `userGesture`<br/>_optional_ | `boolean` | Whether execution should be treated as initiated by user in the UI. |
| `awaitPromise`<br/>_optional_ | `boolean` | Whether execution should `await` for resulting value and return once awaited promise is<br/>resolved. |
| `executionContextId`<br/>_optional_ | [ExecutionContextId](#executioncontextid) | Specifies execution context which global object will be used to call function on. Either<br/>executionContextId or objectId should be specified. |
| `objectGroup`<br/>_optional_ | `string` | Symbolic group name that can be used to release multiple objects. If objectGroup is not<br/>specified and objectId is, objectGroup will be inherited from object. |
| `throwOnSideEffect`<br/>_optional_ | `boolean` | `🧪 experimental` Whether to throw an exception if side effect cannot be ruled out during evaluation. |
| `uniqueContextId`<br/>_optional_ | `string` | `🧪 experimental` An alternative way to specify the execution context to call function on.<br/>Compared to contextId that may be reused across processes, this is guaranteed to be<br/>system-unique, so it can be used to prevent accidental function call<br/>in context different than intended (e.g. as a result of navigation across process<br/>boundaries).<br/>This is mutually exclusive with `executionContextId`. |
| `serializationOptions`<br/>_optional_ | [SerializationOptions](#serializationoptions) | `🧪 experimental` Specifies the result serialization. If provided, overrides<br/>`generatePreview` and `returnByValue`. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | [RemoteObject](#remoteobject) | Call result. |
| `exceptionDetails`<br/>_optional_ | [ExceptionDetails](#exceptiondetails) | Exception details. |


### <a name="compilescript"></a>compileScript

Compiles expression.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `expression` | `string` | Expression to compile. |
| `sourceURL` | `string` | Source url to be set for the script. |
| `persistScript` | `boolean` | Specifies whether the compiled script should be persisted. |
| `executionContextId`<br/>_optional_ | [ExecutionContextId](#executioncontextid) | Specifies in which execution context to perform script run. If the parameter is omitted the<br/>evaluation will be performed in the context of the inspected page. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId`<br/>_optional_ | [ScriptId](#scriptid) | Id of the script. |
| `exceptionDetails`<br/>_optional_ | [ExceptionDetails](#exceptiondetails) | Exception details. |


### <a name="disable"></a>disable

Disables reporting of execution contexts creation.

* **Parameters**: None

* **Returns**: None


### <a name="discardconsoleentries"></a>discardConsoleEntries

Discards collected exceptions and console API calls.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables reporting of execution contexts creation by means of `executionContextCreated` event.
When the reporting gets enabled the event will be sent immediately for each existing execution
context.

* **Parameters**: None

* **Returns**: None


### <a name="evaluate"></a>evaluate

Evaluates expression on global object.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `expression` | `string` | Expression to evaluate. |
| `objectGroup`<br/>_optional_ | `string` | Symbolic group name that can be used to release multiple objects. |
| `includeCommandLineAPI`<br/>_optional_ | `boolean` | Determines whether Command Line API should be available during the evaluation. |
| `silent`<br/>_optional_ | `boolean` | In silent mode exceptions thrown during evaluation are not reported and do not pause<br/>execution. Overrides `setPauseOnException` state. |
| `contextId`<br/>_optional_ | [ExecutionContextId](#executioncontextid) | Specifies in which execution context to perform evaluation. If the parameter is omitted the<br/>evaluation will be performed in the context of the inspected page.<br/>This is mutually exclusive with `uniqueContextId`, which offers an<br/>alternative way to identify the execution context that is more reliable<br/>in a multi-process environment. |
| `returnByValue`<br/>_optional_ | `boolean` | Whether the result is expected to be a JSON object that should be sent by value. |
| `generatePreview`<br/>_optional_ | `boolean` | `🧪 experimental` Whether preview should be generated for the result. |
| `userGesture`<br/>_optional_ | `boolean` | Whether execution should be treated as initiated by user in the UI. |
| `awaitPromise`<br/>_optional_ | `boolean` | Whether execution should `await` for resulting value and return once awaited promise is<br/>resolved. |
| `throwOnSideEffect`<br/>_optional_ | `boolean` | `🧪 experimental` Whether to throw an exception if side effect cannot be ruled out during evaluation.<br/>This implies `disableBreaks` below. |
| `timeout`<br/>_optional_ | [TimeDelta](#timedelta) | `🧪 experimental` Terminate execution after timing out (number of milliseconds). |
| `disableBreaks`<br/>_optional_ | `boolean` | `🧪 experimental` Disable breakpoints during execution. |
| `replMode`<br/>_optional_ | `boolean` | `🧪 experimental` Setting this flag to true enables `let` re-declaration and top-level `await`.<br/>Note that `let` variables can only be re-declared if they originate from<br/>`replMode` themselves. |
| `allowUnsafeEvalBlockedByCSP`<br/>_optional_ | `boolean` | `🧪 experimental` The Content Security Policy (CSP) for the target might block 'unsafe-eval'<br/>which includes eval(), Function(), setTimeout() and setInterval()<br/>when called with non-callable arguments. This flag bypasses CSP for this<br/>evaluation and allows unsafe-eval. Defaults to true. |
| `uniqueContextId`<br/>_optional_ | `string` | `🧪 experimental` An alternative way to specify the execution context to evaluate in.<br/>Compared to contextId that may be reused across processes, this is guaranteed to be<br/>system-unique, so it can be used to prevent accidental evaluation of the expression<br/>in context different than intended (e.g. as a result of navigation across process<br/>boundaries).<br/>This is mutually exclusive with `contextId`. |
| `serializationOptions`<br/>_optional_ | [SerializationOptions](#serializationoptions) | `🧪 experimental` Specifies the result serialization. If provided, overrides<br/>`generatePreview` and `returnByValue`. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | [RemoteObject](#remoteobject) | Evaluation result. |
| `exceptionDetails`<br/>_optional_ | [ExceptionDetails](#exceptiondetails) | Exception details. |


### <a name="getisolateid"></a>getIsolateId `🧪 experimental`

Returns the isolate id.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | The isolate id. |


### <a name="getheapusage"></a>getHeapUsage `🧪 experimental`

Returns the JavaScript heap usage.
It is the total usage of the corresponding isolate not scoped to a particular Runtime.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `usedSize` | `number` | Used JavaScript heap size in bytes. |
| `totalSize` | `number` | Allocated JavaScript heap size in bytes. |
| `embedderHeapUsedSize` | `number` | Used size in bytes in the embedder's garbage-collected heap. |
| `backingStorageSize` | `number` | Size in bytes of backing storage for array buffers and external strings. |


### <a name="getproperties"></a>getProperties

Returns properties of a given object. Object group of the result is inherited from the target
object.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [RemoteObjectId](#remoteobjectid) | Identifier of the object to return properties for. |
| `ownProperties`<br/>_optional_ | `boolean` | If true, returns properties belonging only to the element itself, not to its prototype<br/>chain. |
| `accessorPropertiesOnly`<br/>_optional_ | `boolean` | `🧪 experimental` If true, returns accessor properties (with getter/setter) only; internal properties are not<br/>returned either. |
| `generatePreview`<br/>_optional_ | `boolean` | `🧪 experimental` Whether preview should be generated for the results. |
| `nonIndexedPropertiesOnly`<br/>_optional_ | `boolean` | `🧪 experimental` If true, returns non-indexed properties only. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | array of [PropertyDescriptor](#propertydescriptor) | Object properties. |
| `internalProperties`<br/>_optional_ | array of [InternalPropertyDescriptor](#internalpropertydescriptor) | Internal object properties (only of the element itself). |
| `privateProperties`<br/>_optional_ | array of [PrivatePropertyDescriptor](#privatepropertydescriptor) | `🧪 experimental` Object private properties. |
| `exceptionDetails`<br/>_optional_ | [ExceptionDetails](#exceptiondetails) | Exception details. |


### <a name="globallexicalscopenames"></a>globalLexicalScopeNames

Returns all let, const and class variables from global scope.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `executionContextId`<br/>_optional_ | [ExecutionContextId](#executioncontextid) | Specifies in which execution context to lookup global scope variables. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `names` | array of `string` |  |


### <a name="queryobjects"></a>queryObjects

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `prototypeObjectId` | [RemoteObjectId](#remoteobjectid) | Identifier of the prototype to return objects for. |
| `objectGroup`<br/>_optional_ | `string` | Symbolic group name that can be used to release the results. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `objects` | [RemoteObject](#remoteobject) | Array with objects. |


### <a name="releaseobject"></a>releaseObject

Releases remote object with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [RemoteObjectId](#remoteobjectid) | Identifier of the object to release. |

* **Returns**: None


### <a name="releaseobjectgroup"></a>releaseObjectGroup

Releases all remote objects that belong to a given group.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectGroup` | `string` | Symbolic object group name. |

* **Returns**: None


### <a name="runifwaitingfordebugger"></a>runIfWaitingForDebugger

Tells inspected instance to run if it was waiting for debugger to attach.

* **Parameters**: None

* **Returns**: None


### <a name="runscript"></a>runScript

Runs script with given id in a given context.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [ScriptId](#scriptid) | Id of the script to run. |
| `executionContextId`<br/>_optional_ | [ExecutionContextId](#executioncontextid) | Specifies in which execution context to perform script run. If the parameter is omitted the<br/>evaluation will be performed in the context of the inspected page. |
| `objectGroup`<br/>_optional_ | `string` | Symbolic group name that can be used to release multiple objects. |
| `silent`<br/>_optional_ | `boolean` | In silent mode exceptions thrown during evaluation are not reported and do not pause<br/>execution. Overrides `setPauseOnException` state. |
| `includeCommandLineAPI`<br/>_optional_ | `boolean` | Determines whether Command Line API should be available during the evaluation. |
| `returnByValue`<br/>_optional_ | `boolean` | Whether the result is expected to be a JSON object which should be sent by value. |
| `generatePreview`<br/>_optional_ | `boolean` | Whether preview should be generated for the result. |
| `awaitPromise`<br/>_optional_ | `boolean` | Whether execution should `await` for resulting value and return once awaited promise is<br/>resolved. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | [RemoteObject](#remoteobject) | Run result. |
| `exceptionDetails`<br/>_optional_ | [ExceptionDetails](#exceptiondetails) | Exception details. |


### <a name="setasynccallstackdepth"></a>setAsyncCallStackDepth

Enables or disables async call stacks tracking.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `maxDepth` | `integer` | Maximum depth of async call stacks. Setting to `0` will effectively disable collecting async<br/>call stacks (default). |

* **Returns**: None


### <a name="setcustomobjectformatterenabled"></a>setCustomObjectFormatterEnabled `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` |  |

* **Returns**: None


### <a name="setmaxcallstacksizetocapture"></a>setMaxCallStackSizeToCapture `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `size` | `integer` |  |

* **Returns**: None


### <a name="terminateexecution"></a>terminateExecution `🧪 experimental`

Terminate current or next JavaScript execution.
Will cancel the termination when the outer-most script execution ends.

* **Parameters**: None

* **Returns**: None


### <a name="addbinding"></a>addBinding

If executionContextId is empty, adds binding with the given name on the
global objects of all inspected contexts, including those created later,
bindings survive reloads.
Binding function takes exactly one argument, this argument should be string,
in case of any other input, function throws an exception.
Each binding function call produces Runtime.bindingCalled notification.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `executionContextId`<br/>_optional_ | [ExecutionContextId](#executioncontextid) | `🧪 experimental` `⚠️ deprecated` If specified, the binding would only be exposed to the specified<br/>execution context. If omitted and `executionContextName` is not set,<br/>the binding is exposed to all execution contexts of the target.<br/>This parameter is mutually exclusive with `executionContextName`.<br/>Deprecated in favor of `executionContextName` due to an unclear use case<br/>and bugs in implementation (crbug.com/1169639). `executionContextId` will be<br/>removed in the future. |
| `executionContextName`<br/>_optional_ | `string` | If specified, the binding is exposed to the executionContext with<br/>matching name, even for contexts created after the binding is added.<br/>See also `ExecutionContext.name` and `worldName` parameter to<br/>`Page.addScriptToEvaluateOnNewDocument`.<br/>This parameter is mutually exclusive with `executionContextId`. |

* **Returns**: None


### <a name="removebinding"></a>removeBinding

This method does not remove binding function from global object but
unsubscribes current runtime agent from Runtime.bindingCalled notifications.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |

* **Returns**: None


### <a name="getexceptiondetails"></a>getExceptionDetails `🧪 experimental`

This method tries to lookup and populate exception details for a
JavaScript Error object.
Note that the stackTrace portion of the resulting exceptionDetails will
only be populated if the Runtime domain was enabled at the time when the
Error was thrown.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `errorObjectId` | [RemoteObjectId](#remoteobjectid) | The error object for which to resolve the exception details. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `exceptionDetails`<br/>_optional_ | [ExceptionDetails](#exceptiondetails) |  |


---

<a name="events"></a>
## Events

### <a name="bindingcalled"></a>bindingCalled `🧪 experimental`

Notification is issued every time when binding is called.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `payload` | `string` |  |
| `executionContextId` | [ExecutionContextId](#executioncontextid) | Identifier of the context where the call was made. |


### <a name="consoleapicalled"></a>consoleAPICalled

Issued when console API was called.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Type of the call.<br/>Allowed values: `"log"`, `"debug"`, `"info"`, `"error"`, `"warning"`, `"dir"`, `"dirxml"`, `"table"`, `"trace"`, `"clear"`, `"startGroup"`, `"startGroupCollapsed"`, `"endGroup"`, `"assert"`, `"profile"`, `"profileEnd"`, `"count"`, `"timeEnd"` |
| `args` | array of [RemoteObject](#remoteobject) | Call arguments. |
| `executionContextId` | [ExecutionContextId](#executioncontextid) | Identifier of the context where the call was made. |
| `timestamp` | [Timestamp](#timestamp) | Call timestamp. |
| `stackTrace`<br/>_optional_ | [StackTrace](#stacktrace) | Stack trace captured when the call was made. The async stack chain is automatically reported for<br/>the following call types: `assert`, `error`, `trace`, `warning`. For other types the async call<br/>chain can be retrieved using `Debugger.getStackTrace` and `stackTrace.parentId` field. |
| `context`<br/>_optional_ | `string` | `🧪 experimental` Console context descriptor for calls on non-default console context (not console.*):<br/>'anonymous#unique-logger-id' for call on unnamed context, 'name#unique-logger-id' for call<br/>on named context. |


### <a name="exceptionrevoked"></a>exceptionRevoked

Issued when unhandled exception was revoked.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `reason` | `string` | Reason describing why exception was revoked. |
| `exceptionId` | `integer` | The id of revoked exception, as reported in `exceptionThrown`. |


### <a name="exceptionthrown"></a>exceptionThrown

Issued when exception was thrown and unhandled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `timestamp` | [Timestamp](#timestamp) | Timestamp of the exception. |
| `exceptionDetails` | [ExceptionDetails](#exceptiondetails) |  |


### <a name="executioncontextcreated"></a>executionContextCreated

Issued when new execution context is created.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `context` | [ExecutionContextDescription](#executioncontextdescription) | A newly created execution context. |


### <a name="executioncontextdestroyed"></a>executionContextDestroyed

Issued when execution context is destroyed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `executionContextId` | [ExecutionContextId](#executioncontextid) | `⚠️ deprecated` Id of the destroyed context |
| `executionContextUniqueId` | `string` | `🧪 experimental` Unique Id of the destroyed context |


### <a name="executioncontextscleared"></a>executionContextsCleared

Issued when all executionContexts were cleared in browser

* **Parameters**: None


### <a name="inspectrequested"></a>inspectRequested

Issued when object should be inspected (for example, as a result of inspect() command line API
call).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `object` | [RemoteObject](#remoteobject) |  |
| `hints` | `object` |  |
| `executionContextId`<br/>_optional_ | [ExecutionContextId](#executioncontextid) | `🧪 experimental` Identifier of the context where the call was made. |


