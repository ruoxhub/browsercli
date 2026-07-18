# Target

Supports additional targets discovery and allows to attach to them.

* **Source**: Browser Protocol (Chromium)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="targetid"></a>TargetID

* **Type**: `string`

### <a name="sessionid"></a>SessionID

Unique identifier of attached debugging session.

* **Type**: `string`

### <a name="targetinfo"></a>TargetInfo

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) |  |
| `type` | `string` | List of types: https://source.chromium.org/chromium/chromium/src/+/main:content/browser/devtools/devtools_agent_host_impl.cc?ss=chromium&q=f:devtools%20-f:out%20%22::kTypeTab%5B%5D%22 |
| `title` | `string` |  |
| `url` | `string` |  |
| `attached` | `boolean` | Whether the target has an attached client. |
| `parentId`<br/>_optional_ | [TargetID](#targetid) | Id of the parent target, if any. For example, "iframe" target may have a "page" parent. |
| `openerId`<br/>_optional_ | [TargetID](#targetid) | Opener target Id |
| `canAccessOpener` | `boolean` | `🧪 experimental` Whether the target has access to the originating window. |
| `openerFrameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | `🧪 experimental` Frame id of originating window (is only set if target has an opener). |
| `parentFrameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | `🧪 experimental` Id of the parent frame, present for "iframe" and "worker" targets. For nested workers,<br/>this is the "ancestor" frame that created the first worker in the nested chain. |
| `browserContextId`<br/>_optional_ | [Browser.BrowserContextID](Browser.md#browsercontextid) | `🧪 experimental` |
| `subtype`<br/>_optional_ | `string` | `🧪 experimental` Provides additional details for specific target types. For example, for<br/>the type of "page", this may be set to "prerender". |
| `embedderData`<br/>_optional_ | `object` | `🧪 experimental` Embedder-specific target metadata. This is only set for targets of<br/>type "tab". |


### <a name="filterentry"></a>FilterEntry `🧪 experimental`

A filter used by target query/discovery/auto-attach operations.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `exclude`<br/>_optional_ | `boolean` | If set, causes exclusion of matching targets from the list. |
| `type`<br/>_optional_ | `string` | If not present, matches any type. |


### <a name="targetfilter"></a>TargetFilter `🧪 experimental`

The entries in TargetFilter are matched sequentially against targets and
the first entry that matches determines if the target is included or not,
depending on the value of `exclude` field in the entry.
If filter is not specified, the one assumed is
[{type: "browser", exclude: true}, {type: "tab", exclude: true}, {}]
(i.e. include everything but `browser` and `tab`).

* **Type**: `array`

### <a name="remotelocation"></a>RemoteLocation `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `host` | `string` |  |
| `port` | `integer` |  |


### <a name="windowstate"></a>WindowState `🧪 experimental`

The state of the target window.

* **Type**: `string`
* **Allowed values**: `"normal"`, `"minimized"`, `"maximized"`, `"fullscreen"`

---

<a name="commands"></a>
## Commands

### <a name="activatetarget"></a>activateTarget

Activates (focuses) the target.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) |  |

* **Returns**: None


### <a name="attachtotarget"></a>attachToTarget

Attaches to the target with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) |  |
| `flatten`<br/>_optional_ | `boolean` | Enables "flat" access to the session via specifying sessionId attribute in the commands.<br/>We plan to make this the default, deprecate non-flattened mode,<br/>and eventually retire it. See crbug.com/991325. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `sessionId` | [SessionID](#sessionid) | Id assigned to the session. |


### <a name="attachtobrowsertarget"></a>attachToBrowserTarget `🧪 experimental`

Attaches to the browser target, only uses flat sessionId mode.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `sessionId` | [SessionID](#sessionid) | Id assigned to the session. |


### <a name="closetarget"></a>closeTarget

Closes the target. If the target is a page that gets closed too.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `success` | `boolean` | `⚠️ deprecated` Always set to true. If an error occurs, the response indicates protocol error. |


### <a name="exposedevtoolsprotocol"></a>exposeDevToolsProtocol `🧪 experimental`

Inject object to the target's main frame that provides a communication
channel with browser target.

Injected object will be available as `window[bindingName]`.

The object has the following API:
- `binding.send(json)` - a method to send messages over the remote debugging protocol
- `binding.onmessage = json => handleMessage(json)` - a callback that will be called for the protocol notifications and command responses.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) |  |
| `bindingName`<br/>_optional_ | `string` | Binding name, 'cdp' if not specified. |
| `inheritPermissions`<br/>_optional_ | `boolean` | If true, inherits the current root session's permissions (default: false). |

* **Returns**: None


### <a name="createbrowsercontext"></a>createBrowserContext

Creates a new empty BrowserContext. Similar to an incognito profile but you can have more than
one.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `disposeOnDetach`<br/>_optional_ | `boolean` | `🧪 experimental` If specified, disposes this context when debugging session disconnects. |
| `proxyServer`<br/>_optional_ | `string` | `🧪 experimental` Proxy server, similar to the one passed to --proxy-server |
| `proxyBypassList`<br/>_optional_ | `string` | `🧪 experimental` Proxy bypass list, similar to the one passed to --proxy-bypass-list |
| `originsWithUniversalNetworkAccess`<br/>_optional_ | array of `string` | `🧪 experimental` An optional list of origins to grant unlimited cross-origin access to.<br/>Parts of the URL other than those constituting origin are ignored. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `browserContextId` | [Browser.BrowserContextID](Browser.md#browsercontextid) | The id of the context created. |


### <a name="getbrowsercontexts"></a>getBrowserContexts

Returns all browser contexts created with `Target.createBrowserContext` method.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `browserContextIds` | array of [Browser.BrowserContextID](Browser.md#browsercontextid) | An array of browser context ids. |
| `defaultBrowserContextId`<br/>_optional_ | [Browser.BrowserContextID](Browser.md#browsercontextid) | `🧪 experimental` The id of the default browser context if available. |


### <a name="createtarget"></a>createTarget

Creates a new page.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | The initial URL the page will be navigated to. An empty string indicates about:blank. |
| `left`<br/>_optional_ | `integer` | `🧪 experimental` Frame left origin in DIP (requires newWindow to be true or headless shell). |
| `top`<br/>_optional_ | `integer` | `🧪 experimental` Frame top origin in DIP (requires newWindow to be true or headless shell). |
| `width`<br/>_optional_ | `integer` | Frame width in DIP (requires newWindow to be true or headless shell). |
| `height`<br/>_optional_ | `integer` | Frame height in DIP (requires newWindow to be true or headless shell). |
| `windowState`<br/>_optional_ | [WindowState](#windowstate) | Frame window state (requires newWindow to be true or headless shell).<br/>Default is normal. |
| `browserContextId`<br/>_optional_ | [Browser.BrowserContextID](Browser.md#browsercontextid) | `🧪 experimental` The browser context to create the page in. |
| `enableBeginFrameControl`<br/>_optional_ | `boolean` | `🧪 experimental` Whether BeginFrames for this target will be controlled via DevTools (headless shell only,<br/>not supported on MacOS yet, false by default). |
| `newWindow`<br/>_optional_ | `boolean` | Whether to create a new Window or Tab (false by default, not supported by headless shell). |
| `background`<br/>_optional_ | `boolean` | Whether to create the target in background or foreground (false by default, not supported<br/>by headless shell). |
| `forTab`<br/>_optional_ | `boolean` | `🧪 experimental` Whether to create the target of type "tab". |
| `hidden`<br/>_optional_ | `boolean` | `🧪 experimental` Whether to create a hidden target. The hidden target is observable via protocol, but not<br/>present in the tab UI strip. Cannot be created with `forTab: true`, `newWindow: true` or<br/>`background: false`. The life-time of the tab is limited to the life-time of the session. |
| `focus`<br/>_optional_ | `boolean` | `🧪 experimental` If specified, determines whether the new target should be focused.<br/>By default, the focus behavior depends on the `background` parameter:<br/>- If `background` is false (default) and `focus` is omitted, the new target is focused and the browser window is brought to the foreground.<br/>- If `background` is false and `focus` is false, the target is opened but the browser window's focus remains unchanged (e.g., if the window was in the background, it stays there).<br/>- If `background` is true, setting `focus` to true is not supported and will result in an error. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) | The id of the page opened. |


### <a name="detachfromtarget"></a>detachFromTarget

Detaches session with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sessionId`<br/>_optional_ | [SessionID](#sessionid) | Session to detach. |
| `targetId`<br/>_optional_ | [TargetID](#targetid) | `⚠️ deprecated` Deprecated. |

* **Returns**: None


### <a name="disposebrowsercontext"></a>disposeBrowserContext

Deletes a BrowserContext. All the belonging pages will be closed without calling their
beforeunload hooks.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `browserContextId` | [Browser.BrowserContextID](Browser.md#browsercontextid) |  |

* **Returns**: None


### <a name="gettargetinfo"></a>getTargetInfo `🧪 experimental`

Returns information about a target.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId`<br/>_optional_ | [TargetID](#targetid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `targetInfo` | [TargetInfo](#targetinfo) |  |


### <a name="gettargets"></a>getTargets

Retrieves a list of available targets.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `filter`<br/>_optional_ | [TargetFilter](#targetfilter) | `🧪 experimental` Only targets matching filter will be reported. If filter is not specified<br/>and target discovery is currently enabled, a filter used for target discovery<br/>is used for consistency. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `targetInfos` | array of [TargetInfo](#targetinfo) | The list of targets. |


### <a name="sendmessagetotarget"></a>sendMessageToTarget `⚠️ deprecated`

Sends protocol message over session with given id.
Consider using flat mode instead; see commands attachToTarget, setAutoAttach,
and crbug.com/991325.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `message` | `string` |  |
| `sessionId`<br/>_optional_ | [SessionID](#sessionid) | Identifier of the session. |
| `targetId`<br/>_optional_ | [TargetID](#targetid) | `⚠️ deprecated` Deprecated. |

* **Returns**: None


### <a name="setautoattach"></a>setAutoAttach

Controls whether to automatically attach to new targets which are considered
to be directly related to this one (for example, iframes or workers).
When turned on, attaches to all existing related targets as well. When turned off,
automatically detaches from all currently attached targets.
This also clears all targets added by `autoAttachRelated` from the list of targets to watch
for creation of related targets.
You might want to call this recursively for auto-attached targets to attach
to all available targets.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `autoAttach` | `boolean` | Whether to auto-attach to related targets. |
| `waitForDebuggerOnStart` | `boolean` | Whether to pause new targets when attaching to them. Use `Runtime.runIfWaitingForDebugger`<br/>to run paused targets. |
| `flatten`<br/>_optional_ | `boolean` | `🧪 experimental` Enables "flat" access to the session via specifying sessionId attribute in the commands.<br/>We plan to make this the default, deprecate non-flattened mode,<br/>and eventually retire it. See crbug.com/991325. |
| `filter`<br/>_optional_ | [TargetFilter](#targetfilter) | `🧪 experimental` Only targets matching filter will be attached. |

* **Returns**: None


### <a name="autoattachrelated"></a>autoAttachRelated `🧪 experimental`

Adds the specified target to the list of targets that will be monitored for any related target
creation (such as child frames, child workers and new versions of service worker) and reported
through `attachedToTarget`. The specified target is also auto-attached.
This cancels the effect of any previous `setAutoAttach` and is also cancelled by subsequent
`setAutoAttach`. Only available at the Browser target.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) |  |
| `waitForDebuggerOnStart` | `boolean` | Whether to pause new targets when attaching to them. Use `Runtime.runIfWaitingForDebugger`<br/>to run paused targets. |
| `filter`<br/>_optional_ | [TargetFilter](#targetfilter) | `🧪 experimental` Only targets matching filter will be attached. |

* **Returns**: None


### <a name="setdiscovertargets"></a>setDiscoverTargets

Controls whether to discover available targets and notify via
`targetCreated/targetInfoChanged/targetDestroyed` events.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `discover` | `boolean` | Whether to discover available targets. |
| `filter`<br/>_optional_ | [TargetFilter](#targetfilter) | `🧪 experimental` Only targets matching filter will be attached. If `discover` is false,<br/>`filter` must be omitted or empty. |

* **Returns**: None


### <a name="setremotelocations"></a>setRemoteLocations `🧪 experimental`

Enables target discovery for the specified locations, when `setDiscoverTargets` was set to
`true`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `locations` | array of [RemoteLocation](#remotelocation) | List of remote locations. |

* **Returns**: None


### <a name="getdevtoolstarget"></a>getDevToolsTarget `🧪 experimental`

Gets the targetId of the DevTools page target opened for the given target
(if any).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) | Page or tab target ID. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId`<br/>_optional_ | [TargetID](#targetid) | The targetId of DevTools page target if exists. |


### <a name="opendevtools"></a>openDevTools `🧪 experimental`

Opens a DevTools window for the target.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) | This can be the page or tab target ID. |
| `panelId`<br/>_optional_ | `string` | The id of the panel we want DevTools to open initially. Currently<br/>supported panels are elements, console, network, sources, resources,<br/>timeline, chrome-recorder, heap-profiler, lighthouse, and security. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) | The targetId of DevTools page target. |


---

<a name="events"></a>
## Events

### <a name="attachedtotarget"></a>attachedToTarget `🧪 experimental`

Issued when attached to target because of auto-attach or `attachToTarget` command.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sessionId` | [SessionID](#sessionid) | Identifier assigned to the session used to send/receive messages. |
| `targetInfo` | [TargetInfo](#targetinfo) |  |
| `waitingForDebugger` | `boolean` |  |


### <a name="detachedfromtarget"></a>detachedFromTarget `🧪 experimental`

Issued when detached from target for any reason (including `detachFromTarget` command). Can be
issued multiple times per target if multiple sessions have been attached to it.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sessionId` | [SessionID](#sessionid) | Detached session identifier. |
| `targetId`<br/>_optional_ | [TargetID](#targetid) | `⚠️ deprecated` Deprecated. |


### <a name="receivedmessagefromtarget"></a>receivedMessageFromTarget

Notifies about a new protocol message received from the session (as reported in
`attachedToTarget` event).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sessionId` | [SessionID](#sessionid) | Identifier of a session which sends a message. |
| `message` | `string` |  |
| `targetId`<br/>_optional_ | [TargetID](#targetid) | `⚠️ deprecated` Deprecated. |


### <a name="targetcreated"></a>targetCreated

Issued when a possible inspection target is created.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetInfo` | [TargetInfo](#targetinfo) |  |


### <a name="targetdestroyed"></a>targetDestroyed

Issued when a target is destroyed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) |  |


### <a name="targetcrashed"></a>targetCrashed

Issued when a target has crashed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [TargetID](#targetid) |  |
| `status` | `string` | Termination status type. |
| `errorCode` | `integer` | Termination error code. |


### <a name="targetinfochanged"></a>targetInfoChanged

Issued when some information about a target has changed. This only happens between
`targetCreated` and `targetDestroyed`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetInfo` | [TargetInfo](#targetinfo) |  |


