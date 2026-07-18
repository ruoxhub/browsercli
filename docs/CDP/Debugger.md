# Debugger

Debugger domain exposes JavaScript debugging capabilities. It allows setting and removing
breakpoints, stepping through execution, exploring stack traces, etc.

* **Source**: JS Protocol (V8)
* **Dependencies**: [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="breakpointid"></a>BreakpointId

Breakpoint identifier.

* **Type**: `string`

### <a name="callframeid"></a>CallFrameId

Call frame identifier.

* **Type**: `string`

### <a name="location"></a>Location

Location in the source code.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Script identifier as reported in the `Debugger.scriptParsed`. |
| `lineNumber` | `integer` | Line number in the script (0-based). |
| `columnNumber`<br/>_optional_ | `integer` | Column number in the script (0-based). |


### <a name="scriptposition"></a>ScriptPosition `🧪 experimental`

Location in the source code.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `lineNumber` | `integer` |  |
| `columnNumber` | `integer` |  |


### <a name="locationrange"></a>LocationRange `🧪 experimental`

Location range within one script.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) |  |
| `start` | [ScriptPosition](#scriptposition) |  |
| `end` | [ScriptPosition](#scriptposition) |  |


### <a name="callframe"></a>CallFrame

JavaScript call frame. Array of call frames form the call stack.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `callFrameId` | [CallFrameId](#callframeid) | Call frame identifier. This identifier is only valid while the virtual machine is paused. |
| `functionName` | `string` | Name of the JavaScript function called on this call frame. |
| `functionLocation`<br/>_optional_ | [Location](#location) | Location in the source code. |
| `location` | [Location](#location) | Location in the source code. |
| `url` | `string` | `⚠️ deprecated` JavaScript script name or url.<br/>Deprecated in favor of using the `location.scriptId` to resolve the URL via a previously<br/>sent `Debugger.scriptParsed` event. |
| `scopeChain` | array of [Scope](#scope) | Scope chain for this call frame. |
| `this` | [Runtime.RemoteObject](Runtime.md#remoteobject) | `this` object for this call frame. |
| `returnValue`<br/>_optional_ | [Runtime.RemoteObject](Runtime.md#remoteobject) | The value being returned, if the function is at return point. |
| `canBeRestarted`<br/>_optional_ | `boolean` | `🧪 experimental` Valid only while the VM is paused and indicates whether this frame<br/>can be restarted or not. Note that a `true` value here does not<br/>guarantee that Debugger#restartFrame with this CallFrameId will be<br/>successful, but it is very likely. |


### <a name="scope"></a>Scope

Scope description.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Scope type.<br/>Allowed values: `"global"`, `"local"`, `"with"`, `"closure"`, `"catch"`, `"block"`, `"script"`, `"eval"`, `"module"`, `"wasm-expression-stack"` |
| `object` | [Runtime.RemoteObject](Runtime.md#remoteobject) | Object representing the scope. For `global` and `with` scopes it represents the actual<br/>object; for the rest of the scopes, it is artificial transient object enumerating scope<br/>variables as its properties. |
| `name`<br/>_optional_ | `string` |  |
| `startLocation`<br/>_optional_ | [Location](#location) | Location in the source code where scope starts |
| `endLocation`<br/>_optional_ | [Location](#location) | Location in the source code where scope ends |


### <a name="searchmatch"></a>SearchMatch

Search match for resource.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `lineNumber` | `number` | Line number in resource content. |
| `lineContent` | `string` | Line with match content. |


### <a name="breaklocation"></a>BreakLocation

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Script identifier as reported in the `Debugger.scriptParsed`. |
| `lineNumber` | `integer` | Line number in the script (0-based). |
| `columnNumber`<br/>_optional_ | `integer` | Column number in the script (0-based). |
| `type`<br/>_optional_ | `string` | Allowed values: `"debuggerStatement"`, `"call"`, `"return"` |


### <a name="wasmdisassemblychunk"></a>WasmDisassemblyChunk `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `lines` | array of `string` | The next chunk of disassembled lines. |
| `bytecodeOffsets` | array of `integer` | The bytecode offsets describing the start of each line. |


### <a name="scriptlanguage"></a>ScriptLanguage

Enum of possible script languages.

* **Type**: `string`
* **Allowed values**: `"JavaScript"`, `"WebAssembly"`

### <a name="debugsymbols"></a>DebugSymbols

Debug symbols available for a wasm script.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Type of the debug symbols.<br/>Allowed values: `"SourceMap"`, `"EmbeddedDWARF"`, `"ExternalDWARF"` |
| `externalURL`<br/>_optional_ | `string` | URL of the external symbol source. |


### <a name="resolvedbreakpoint"></a>ResolvedBreakpoint

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `breakpointId` | [BreakpointId](#breakpointid) | Breakpoint unique identifier. |
| `location` | [Location](#location) | Actual breakpoint location. |


---

<a name="commands"></a>
## Commands

### <a name="continuetolocation"></a>continueToLocation

Continues execution until specific location is reached.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `location` | [Location](#location) | Location to continue to. |
| `targetCallFrames`<br/>_optional_ | `string` | Allowed values: `"any"`, `"current"` |

* **Returns**: None


### <a name="disable"></a>disable

Disables debugger for given page.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables debugger for the given page. Clients should not assume that the debugging has been
enabled until the result for this command is received.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `maxScriptsCacheSize`<br/>_optional_ | `number` | `🧪 experimental` The maximum size in bytes of collected scripts (not referenced by other heap objects)<br/>the debugger can hold. Puts no limit if parameter is omitted. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `debuggerId` | [Runtime.UniqueDebuggerId](Runtime.md#uniquedebuggerid) | `🧪 experimental` Unique identifier of the debugger. |


### <a name="evaluateoncallframe"></a>evaluateOnCallFrame

Evaluates expression on a given call frame.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `callFrameId` | [CallFrameId](#callframeid) | Call frame identifier to evaluate on. |
| `expression` | `string` | Expression to evaluate. |
| `objectGroup`<br/>_optional_ | `string` | String object group name to put result into (allows rapid releasing resulting object handles<br/>using `releaseObjectGroup`). |
| `includeCommandLineAPI`<br/>_optional_ | `boolean` | Specifies whether command line API should be available to the evaluated expression, defaults<br/>to false. |
| `silent`<br/>_optional_ | `boolean` | In silent mode exceptions thrown during evaluation are not reported and do not pause<br/>execution. Overrides `setPauseOnException` state. |
| `returnByValue`<br/>_optional_ | `boolean` | Whether the result is expected to be a JSON object that should be sent by value. |
| `generatePreview`<br/>_optional_ | `boolean` | `🧪 experimental` Whether preview should be generated for the result. |
| `throwOnSideEffect`<br/>_optional_ | `boolean` | Whether to throw an exception if side effect cannot be ruled out during evaluation. |
| `timeout`<br/>_optional_ | [Runtime.TimeDelta](Runtime.md#timedelta) | `🧪 experimental` Terminate execution after timing out (number of milliseconds). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | [Runtime.RemoteObject](Runtime.md#remoteobject) | Object wrapper for the evaluation result. |
| `exceptionDetails`<br/>_optional_ | [Runtime.ExceptionDetails](Runtime.md#exceptiondetails) | Exception details. |


### <a name="getpossiblebreakpoints"></a>getPossibleBreakpoints

Returns possible locations for breakpoint. scriptId in start and end range locations should be
the same.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `start` | [Location](#location) | Start of range to search possible breakpoint locations in. |
| `end`<br/>_optional_ | [Location](#location) | End of range to search possible breakpoint locations in (excluding). When not specified, end<br/>of scripts is used as end of range. |
| `restrictToFunction`<br/>_optional_ | `boolean` | Only consider locations which are in the same (non-nested) function as start. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `locations` | array of [BreakLocation](#breaklocation) | List of the possible breakpoint locations. |


### <a name="getscriptsource"></a>getScriptSource

Returns source for the script with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Id of the script to get source for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptSource` | `string` | Script source (empty in case of Wasm bytecode). |
| `bytecode`<br/>_optional_ | `string` | Wasm bytecode. (Encoded as a base64 string when passed over JSON) |


### <a name="disassemblewasmmodule"></a>disassembleWasmModule `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Id of the script to disassemble |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `streamId`<br/>_optional_ | `string` | For large modules, return a stream from which additional chunks of<br/>disassembly can be read successively. |
| `totalNumberOfLines` | `integer` | The total number of lines in the disassembly text. |
| `functionBodyOffsets` | array of `integer` | The offsets of all function bodies, in the format [start1, end1,<br/>start2, end2, ...] where all ends are exclusive. |
| `chunk` | [WasmDisassemblyChunk](#wasmdisassemblychunk) | The first chunk of disassembly. |


### <a name="nextwasmdisassemblychunk"></a>nextWasmDisassemblyChunk `🧪 experimental`

Disassemble the next chunk of lines for the module corresponding to the
stream. If disassembly is complete, this API will invalidate the streamId
and return an empty chunk. Any subsequent calls for the now invalid stream
will return errors.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `streamId` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `chunk` | [WasmDisassemblyChunk](#wasmdisassemblychunk) | The next chunk of disassembly. |


### <a name="getwasmbytecode"></a>getWasmBytecode `⚠️ deprecated`

This command is deprecated. Use getScriptSource instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Id of the Wasm script to get source for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `bytecode` | `string` | Script source. (Encoded as a base64 string when passed over JSON) |


### <a name="getstacktrace"></a>getStackTrace `🧪 experimental`

Returns stack trace with given `stackTraceId`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `stackTraceId` | [Runtime.StackTraceId](Runtime.md#stacktraceid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `stackTrace` | [Runtime.StackTrace](Runtime.md#stacktrace) |  |


### <a name="pause"></a>pause

Stops on the next JavaScript statement.

* **Parameters**: None

* **Returns**: None


### <a name="pauseonasynccall"></a>pauseOnAsyncCall `🧪 experimental` `⚠️ deprecated`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `parentStackTraceId` | [Runtime.StackTraceId](Runtime.md#stacktraceid) | Debugger will pause when async call with given stack trace is started. |

* **Returns**: None


### <a name="removebreakpoint"></a>removeBreakpoint

Removes JavaScript breakpoint.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `breakpointId` | [BreakpointId](#breakpointid) |  |

* **Returns**: None


### <a name="restartframe"></a>restartFrame

Restarts particular call frame from the beginning. The old, deprecated
behavior of `restartFrame` is to stay paused and allow further CDP commands
after a restart was scheduled. This can cause problems with restarting, so
we now continue execution immediatly after it has been scheduled until we
reach the beginning of the restarted frame.

To stay back-wards compatible, `restartFrame` now expects a `mode`
parameter to be present. If the `mode` parameter is missing, `restartFrame`
errors out.

The various return values are deprecated and `callFrames` is always empty.
Use the call frames from the `Debugger#paused` events instead, that fires
once V8 pauses at the beginning of the restarted function.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `callFrameId` | [CallFrameId](#callframeid) | Call frame identifier to evaluate on. |
| `mode`<br/>_optional_ | `string` | `🧪 experimental` The `mode` parameter must be present and set to 'StepInto', otherwise<br/>`restartFrame` will error out.<br/>Allowed values: `"StepInto"` |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `callFrames` | array of [CallFrame](#callframe) | `⚠️ deprecated` New stack trace. |
| `asyncStackTrace`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | `⚠️ deprecated` Async stack trace, if any. |
| `asyncStackTraceId`<br/>_optional_ | [Runtime.StackTraceId](Runtime.md#stacktraceid) | `⚠️ deprecated` Async stack trace, if any. |


### <a name="resume"></a>resume

Resumes JavaScript execution.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `terminateOnResume`<br/>_optional_ | `boolean` | Set to true to terminate execution upon resuming execution. In contrast<br/>to Runtime.terminateExecution, this will allows to execute further<br/>JavaScript (i.e. via evaluation) until execution of the paused code<br/>is actually resumed, at which point termination is triggered.<br/>If execution is currently not paused, this parameter has no effect. |

* **Returns**: None


### <a name="searchincontent"></a>searchInContent

Searches for given string in script content.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Id of the script to search in. |
| `query` | `string` | String to search for. |
| `caseSensitive`<br/>_optional_ | `boolean` | If true, search is case sensitive. |
| `isRegex`<br/>_optional_ | `boolean` | If true, treats string parameter as regex. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | array of [SearchMatch](#searchmatch) | List of search matches. |


### <a name="setasynccallstackdepth"></a>setAsyncCallStackDepth

Enables or disables async call stacks tracking.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `maxDepth` | `integer` | Maximum depth of async call stacks. Setting to `0` will effectively disable collecting async<br/>call stacks (default). |

* **Returns**: None


### <a name="setblackboxexecutioncontexts"></a>setBlackboxExecutionContexts `🧪 experimental`

Replace previous blackbox execution contexts with passed ones. Forces backend to skip
stepping/pausing in scripts in these execution contexts. VM will try to leave blackboxed script by
performing 'step in' several times, finally resorting to 'step out' if unsuccessful.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `uniqueIds` | array of `string` | Array of execution context unique ids for the debugger to ignore. |

* **Returns**: None


### <a name="setblackboxpatterns"></a>setBlackboxPatterns `🧪 experimental`

Replace previous blackbox patterns with passed ones. Forces backend to skip stepping/pausing in
scripts with url matching one of the patterns. VM will try to leave blackboxed script by
performing 'step in' several times, finally resorting to 'step out' if unsuccessful.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `patterns` | array of `string` | Array of regexps that will be used to check script url for blackbox state. |
| `skipAnonymous`<br/>_optional_ | `boolean` | If true, also ignore scripts with no source url. |

* **Returns**: None


### <a name="setblackboxedranges"></a>setBlackboxedRanges `🧪 experimental`

Makes backend skip steps in the script in blackboxed ranges. VM will try leave blacklisted
scripts by performing 'step in' several times, finally resorting to 'step out' if unsuccessful.
Positions array contains positions where blackbox state is changed. First interval isn't
blackboxed. Array should be sorted.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Id of the script. |
| `positions` | array of [ScriptPosition](#scriptposition) |  |

* **Returns**: None


### <a name="setbreakpoint"></a>setBreakpoint

Sets JavaScript breakpoint at a given location.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `location` | [Location](#location) | Location to set breakpoint in. |
| `condition`<br/>_optional_ | `string` | Expression to use as a breakpoint condition. When specified, debugger will only stop on the<br/>breakpoint if this expression evaluates to true. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `breakpointId` | [BreakpointId](#breakpointid) | Id of the created breakpoint for further reference. |
| `actualLocation` | [Location](#location) | Location this breakpoint resolved into. |


### <a name="setinstrumentationbreakpoint"></a>setInstrumentationBreakpoint

Sets instrumentation breakpoint.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `instrumentation` | `string` | Instrumentation name.<br/>Allowed values: `"beforeScriptExecution"`, `"beforeScriptWithSourceMapExecution"` |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `breakpointId` | [BreakpointId](#breakpointid) | Id of the created breakpoint for further reference. |


### <a name="setbreakpointbyurl"></a>setBreakpointByUrl

Sets JavaScript breakpoint at given location specified either by URL or URL regex. Once this
command is issued, all existing parsed scripts will have breakpoints resolved and returned in
`locations` property. Further matching script parsing will result in subsequent
`breakpointResolved` events issued. This logical breakpoint will survive page reloads.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `lineNumber` | `integer` | Line number to set breakpoint at. |
| `url`<br/>_optional_ | `string` | URL of the resources to set breakpoint on. |
| `urlRegex`<br/>_optional_ | `string` | Regex pattern for the URLs of the resources to set breakpoints on. Either `url` or<br/>`urlRegex` must be specified. |
| `scriptHash`<br/>_optional_ | `string` | Script hash of the resources to set breakpoint on. |
| `columnNumber`<br/>_optional_ | `integer` | Offset in the line to set breakpoint at. |
| `condition`<br/>_optional_ | `string` | Expression to use as a breakpoint condition. When specified, debugger will only stop on the<br/>breakpoint if this expression evaluates to true. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `breakpointId` | [BreakpointId](#breakpointid) | Id of the created breakpoint for further reference. |
| `locations` | array of [Location](#location) | List of the locations this breakpoint resolved into upon addition. |


### <a name="setbreakpointonfunctioncall"></a>setBreakpointOnFunctionCall `🧪 experimental`

Sets JavaScript breakpoint before each call to the given function.
If another function was created from the same source as a given one,
calling it will also trigger the breakpoint.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | Function object id. |
| `condition`<br/>_optional_ | `string` | Expression to use as a breakpoint condition. When specified, debugger will<br/>stop on the breakpoint if this expression evaluates to true. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `breakpointId` | [BreakpointId](#breakpointid) | Id of the created breakpoint for further reference. |


### <a name="setbreakpointsactive"></a>setBreakpointsActive

Activates / deactivates all breakpoints on the page.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `active` | `boolean` | New value for breakpoints active state. |

* **Returns**: None


### <a name="setpauseonexceptions"></a>setPauseOnExceptions

Defines pause on exceptions state. Can be set to stop on all exceptions, uncaught exceptions,
or caught exceptions, no exceptions. Initial pause on exceptions state is `none`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `state` | `string` | Pause on exceptions mode.<br/>Allowed values: `"none"`, `"caught"`, `"uncaught"`, `"all"` |

* **Returns**: None


### <a name="setreturnvalue"></a>setReturnValue `🧪 experimental`

Changes return value in top frame. Available only at return break position.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `newValue` | [Runtime.CallArgument](Runtime.md#callargument) | New return value. |

* **Returns**: None


### <a name="setscriptsource"></a>setScriptSource

Edits JavaScript source live.

In general, functions that are currently on the stack can not be edited with
a single exception: If the edited function is the top-most stack frame and
that is the only activation of that function on the stack. In this case
the live edit will be successful and a `Debugger.restartFrame` for the
top-most function is automatically triggered.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Id of the script to edit. |
| `scriptSource` | `string` | New content of the script. |
| `dryRun`<br/>_optional_ | `boolean` | If true the change will not actually be applied. Dry run may be used to get result<br/>description without actually modifying the code. |
| `allowTopFrameEditing`<br/>_optional_ | `boolean` | `🧪 experimental` If true, then `scriptSource` is allowed to change the function on top of the stack<br/>as long as the top-most stack frame is the only activation of that function. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `callFrames`<br/>_optional_ | array of [CallFrame](#callframe) | `⚠️ deprecated` New stack trace in case editing has happened while VM was stopped. |
| `stackChanged`<br/>_optional_ | `boolean` | `⚠️ deprecated` Whether current call stack  was modified after applying the changes. |
| `asyncStackTrace`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | `⚠️ deprecated` Async stack trace, if any. |
| `asyncStackTraceId`<br/>_optional_ | [Runtime.StackTraceId](Runtime.md#stacktraceid) | `⚠️ deprecated` Async stack trace, if any. |
| `status` | `string` | `🧪 experimental` Whether the operation was successful or not. Only `Ok` denotes a<br/>successful live edit while the other enum variants denote why<br/>the live edit failed.<br/>Allowed values: `"Ok"`, `"CompileError"`, `"BlockedByActiveGenerator"`, `"BlockedByActiveFunction"`, `"BlockedByTopLevelEsModuleChange"` |
| `exceptionDetails`<br/>_optional_ | [Runtime.ExceptionDetails](Runtime.md#exceptiondetails) | Exception details if any. Only present when `status` is `CompileError`. |


### <a name="setskipallpauses"></a>setSkipAllPauses

Makes page not interrupt on any pauses (breakpoint, exception, dom exception etc).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `skip` | `boolean` | New value for skip pauses state. |

* **Returns**: None


### <a name="setvariablevalue"></a>setVariableValue

Changes value of variable in a callframe. Object-based scopes are not supported and must be
mutated manually.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scopeNumber` | `integer` | 0-based number of scope as was listed in scope chain. Only 'local', 'closure' and 'catch'<br/>scope types are allowed. Other scopes could be manipulated manually. |
| `variableName` | `string` | Variable name. |
| `newValue` | [Runtime.CallArgument](Runtime.md#callargument) | New variable value. |
| `callFrameId` | [CallFrameId](#callframeid) | Id of callframe that holds variable. |

* **Returns**: None


### <a name="stepinto"></a>stepInto

Steps into the function call.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `breakOnAsyncCall`<br/>_optional_ | `boolean` | `🧪 experimental` Debugger will pause on the execution of the first async task which was scheduled<br/>before next pause. |
| `skipList`<br/>_optional_ | array of [LocationRange](#locationrange) | `🧪 experimental` The skipList specifies location ranges that should be skipped on step into. |

* **Returns**: None


### <a name="stepout"></a>stepOut

Steps out of the function call.

* **Parameters**: None

* **Returns**: None


### <a name="stepover"></a>stepOver

Steps over the statement.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `skipList`<br/>_optional_ | array of [LocationRange](#locationrange) | `🧪 experimental` The skipList specifies location ranges that should be skipped on step over. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="breakpointresolved"></a>breakpointResolved `⚠️ deprecated`

Fired when breakpoint is resolved to an actual script and location.
Deprecated in favor of `resolvedBreakpoints` in the `scriptParsed` event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `breakpointId` | [BreakpointId](#breakpointid) | Breakpoint unique identifier. |
| `location` | [Location](#location) | Actual breakpoint location. |


### <a name="paused"></a>paused

Fired when the virtual machine stopped on breakpoint or exception or any other stop criteria.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `callFrames` | array of [CallFrame](#callframe) | Call stack the virtual machine stopped on. |
| `reason` | `string` | Pause reason.<br/>Allowed values: `"ambiguous"`, `"assert"`, `"CSPViolation"`, `"debugCommand"`, `"DOM"`, `"EventListener"`, `"exception"`, `"instrumentation"`, `"OOM"`, `"other"`, `"promiseRejection"`, `"XHR"`, `"step"` |
| `data`<br/>_optional_ | `object` | Object containing break-specific auxiliary properties. |
| `hitBreakpoints`<br/>_optional_ | array of `string` | Hit breakpoints IDs |
| `asyncStackTrace`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | Async stack trace, if any. |
| `asyncStackTraceId`<br/>_optional_ | [Runtime.StackTraceId](Runtime.md#stacktraceid) | `🧪 experimental` Async stack trace, if any. |
| `asyncCallStackTraceId`<br/>_optional_ | [Runtime.StackTraceId](Runtime.md#stacktraceid) | `🧪 experimental` `⚠️ deprecated` Never present, will be removed. |


### <a name="resumed"></a>resumed

Fired when the virtual machine resumed execution.

* **Parameters**: None


### <a name="scriptfailedtoparse"></a>scriptFailedToParse

Fired when virtual machine fails to parse the script.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Identifier of the script parsed. |
| `url` | `string` | URL or name of the script parsed (if any). |
| `startLine` | `integer` | Line offset of the script within the resource with given URL (for script tags). |
| `startColumn` | `integer` | Column offset of the script within the resource with given URL. |
| `endLine` | `integer` | Last line of the script. |
| `endColumn` | `integer` | Length of the last line of the script. |
| `executionContextId` | [Runtime.ExecutionContextId](Runtime.md#executioncontextid) | Specifies script creation context. |
| `hash` | `string` | Content hash of the script, SHA-256. |
| `buildId` | `string` | For Wasm modules, the content of the `build_id` custom section. For JavaScript the `debugId` magic comment. |
| `executionContextAuxData`<br/>_optional_ | `object` | Embedder-specific auxiliary data likely matching {isDefault: boolean, type: 'default'\|'isolated'\|'worker', frameId: string} |
| `sourceMapURL`<br/>_optional_ | `string` | URL of source map associated with script (if any). |
| `hasSourceURL`<br/>_optional_ | `boolean` | True, if this script has sourceURL. |
| `isModule`<br/>_optional_ | `boolean` | True, if this script is ES6 module. |
| `length`<br/>_optional_ | `integer` | This script length. |
| `stackTrace`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | `🧪 experimental` JavaScript top stack frame of where the script parsed event was triggered if available. |
| `codeOffset`<br/>_optional_ | `integer` | `🧪 experimental` If the scriptLanguage is WebAssembly, the code section offset in the module. |
| `scriptLanguage`<br/>_optional_ | [ScriptLanguage](#scriptlanguage) | `🧪 experimental` The language of the script. |
| `embedderName`<br/>_optional_ | `string` | `🧪 experimental` The name the embedder supplied for this script. |


### <a name="scriptparsed"></a>scriptParsed

Fired when virtual machine parses script. This event is also fired for all known and uncollected
scripts upon enabling debugger.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Identifier of the script parsed. |
| `url` | `string` | URL or name of the script parsed (if any). |
| `startLine` | `integer` | Line offset of the script within the resource with given URL (for script tags). |
| `startColumn` | `integer` | Column offset of the script within the resource with given URL. |
| `endLine` | `integer` | Last line of the script. |
| `endColumn` | `integer` | Length of the last line of the script. |
| `executionContextId` | [Runtime.ExecutionContextId](Runtime.md#executioncontextid) | Specifies script creation context. |
| `hash` | `string` | Content hash of the script, SHA-256. |
| `buildId` | `string` | For Wasm modules, the content of the `build_id` custom section. For JavaScript the `debugId` magic comment. |
| `executionContextAuxData`<br/>_optional_ | `object` | Embedder-specific auxiliary data likely matching {isDefault: boolean, type: 'default'\|'isolated'\|'worker', frameId: string} |
| `isLiveEdit`<br/>_optional_ | `boolean` | `🧪 experimental` True, if this script is generated as a result of the live edit operation. |
| `sourceMapURL`<br/>_optional_ | `string` | URL of source map associated with script (if any). |
| `hasSourceURL`<br/>_optional_ | `boolean` | True, if this script has sourceURL. |
| `isModule`<br/>_optional_ | `boolean` | True, if this script is ES6 module. |
| `length`<br/>_optional_ | `integer` | This script length. |
| `stackTrace`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | `🧪 experimental` JavaScript top stack frame of where the script parsed event was triggered if available. |
| `codeOffset`<br/>_optional_ | `integer` | `🧪 experimental` If the scriptLanguage is WebAssembly, the code section offset in the module. |
| `scriptLanguage`<br/>_optional_ | [ScriptLanguage](#scriptlanguage) | `🧪 experimental` The language of the script. |
| `debugSymbols`<br/>_optional_ | array of [DebugSymbols](#debugsymbols) | `🧪 experimental` If the scriptLanguage is WebAssembly, the source of debug symbols for the module. |
| `embedderName`<br/>_optional_ | `string` | `🧪 experimental` The name the embedder supplied for this script. |
| `resolvedBreakpoints`<br/>_optional_ | array of [ResolvedBreakpoint](#resolvedbreakpoint) | `🧪 experimental` The list of set breakpoints in this script if calls to `setBreakpointByUrl`<br/>matches this script's URL or hash. Clients that use this list can ignore the<br/>`breakpointResolved` event. They are equivalent. |


