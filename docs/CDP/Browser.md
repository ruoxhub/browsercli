# Browser

The Browser domain defines methods and events for browser managing.

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

### <a name="browsercontextid"></a>BrowserContextID `🧪 experimental`

* **Type**: `string`

### <a name="windowid"></a>WindowID `🧪 experimental`

* **Type**: `integer`

### <a name="windowstate"></a>WindowState `🧪 experimental`

The state of the browser window.

* **Type**: `string`
* **Allowed values**: `"normal"`, `"minimized"`, `"maximized"`, `"fullscreen"`

### <a name="bounds"></a>Bounds `🧪 experimental`

Browser window bounds information

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `left`<br/>_optional_ | `integer` | The offset from the left edge of the screen to the window in pixels. |
| `top`<br/>_optional_ | `integer` | The offset from the top edge of the screen to the window in pixels. |
| `width`<br/>_optional_ | `integer` | The window width in pixels. |
| `height`<br/>_optional_ | `integer` | The window height in pixels. |
| `windowState`<br/>_optional_ | [WindowState](#windowstate) | The window state. Default to normal. |


### <a name="permissiontype"></a>PermissionType `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"ar"`, `"audioCapture"`, `"automaticFullscreen"`, `"backgroundFetch"`, `"backgroundSync"`, `"cameraPanTiltZoom"`, `"capturedSurfaceControl"`, `"clipboardReadWrite"`, `"clipboardSanitizedWrite"`, `"displayCapture"`, `"durableStorage"`, `"geolocation"`, `"handTracking"`, `"idleDetection"`, `"keyboardLock"`, `"localFonts"`, `"localNetwork"`, `"localNetworkAccess"`, `"loopbackNetwork"`, `"midi"`, `"midiSysex"`, `"nfc"`, `"notifications"`, `"paymentHandler"`, `"periodicBackgroundSync"`, `"pointerLock"`, `"protectedMediaIdentifier"`, `"sensors"`, `"smartCard"`, `"speakerSelection"`, `"storageAccess"`, `"topLevelStorageAccess"`, `"videoCapture"`, `"vr"`, `"wakeLockScreen"`, `"wakeLockSystem"`, `"webAppInstallation"`, `"webPrinting"`, `"windowManagement"`

### <a name="permissionsetting"></a>PermissionSetting `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"granted"`, `"denied"`, `"prompt"`

### <a name="permissiondescriptor"></a>PermissionDescriptor `🧪 experimental`

Definition of PermissionDescriptor defined in the Permissions API:
https://w3c.github.io/permissions/#dom-permissiondescriptor.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Name of permission.<br/>See https://cs.chromium.org/chromium/src/third_party/blink/renderer/modules/permissions/permission_descriptor.idl for valid permission names. |
| `sysex`<br/>_optional_ | `boolean` | For "midi" permission, may also specify sysex control. |
| `userVisibleOnly`<br/>_optional_ | `boolean` | For "push" permission, may specify userVisibleOnly.<br/>Note that userVisibleOnly = true is the only currently supported type. |
| `allowWithoutSanitization`<br/>_optional_ | `boolean` | For "clipboard" permission, may specify allowWithoutSanitization. |
| `allowWithoutGesture`<br/>_optional_ | `boolean` | For "fullscreen" permission, must specify allowWithoutGesture:true. |
| `panTiltZoom`<br/>_optional_ | `boolean` | For "camera" permission, may specify panTiltZoom. |


### <a name="browsercommandid"></a>BrowserCommandId `🧪 experimental`

Browser command ids used by executeBrowserCommand.

* **Type**: `string`
* **Allowed values**: `"openTabSearch"`, `"closeTabSearch"`, `"openGlic"`

### <a name="bucket"></a>Bucket `🧪 experimental`

Chrome histogram bucket.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `low` | `integer` | Minimum value (inclusive). |
| `high` | `integer` | Maximum value (exclusive). |
| `count` | `integer` | Number of samples. |


### <a name="histogram"></a>Histogram `🧪 experimental`

Chrome histogram.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Name. |
| `sum` | `integer` | Sum of sample values. |
| `count` | `integer` | Total number of samples. |
| `buckets` | array of [Bucket](#bucket) | Buckets. |


### <a name="privacysandboxapi"></a>PrivacySandboxAPI `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"BiddingAndAuctionServices"`, `"TrustedKeyValue"`

---

<a name="commands"></a>
## Commands

### <a name="setpermission"></a>setPermission `🧪 experimental`

Set permission settings for given embedding and embedded origins.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `permission` | [PermissionDescriptor](#permissiondescriptor) | Descriptor of permission to override. |
| `setting` | [PermissionSetting](#permissionsetting) | Setting of the permission. |
| `origin`<br/>_optional_ | `string` | Embedding origin the permission applies to, all origins if not specified. |
| `embeddedOrigin`<br/>_optional_ | `string` | Embedded origin the permission applies to. It is ignored unless the embedding origin is<br/>present and valid. If the embedding origin is provided but the embedded origin isn't, the<br/>embedding origin is used as the embedded origin. |
| `browserContextId`<br/>_optional_ | [BrowserContextID](#browsercontextid) | Context to override. When omitted, default browser context is used. |

* **Returns**: None


### <a name="grantpermissions"></a>grantPermissions `🧪 experimental` `⚠️ deprecated`

Grant specific permissions to the given origin and reject all others. Deprecated. Use
setPermission instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `permissions` | array of [PermissionType](#permissiontype) |  |
| `origin`<br/>_optional_ | `string` | Origin the permission applies to, all origins if not specified. |
| `browserContextId`<br/>_optional_ | [BrowserContextID](#browsercontextid) | BrowserContext to override permissions. When omitted, default browser context is used. |

* **Returns**: None


### <a name="resetpermissions"></a>resetPermissions

Reset all permission management for all origins.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `browserContextId`<br/>_optional_ | [BrowserContextID](#browsercontextid) | BrowserContext to reset permissions. When omitted, default browser context is used. |

* **Returns**: None


### <a name="setdownloadbehavior"></a>setDownloadBehavior `🧪 experimental`

Set the behavior when downloading a file.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `behavior` | `string` | Whether to allow all or deny all download requests, or use default Chrome behavior if<br/>available (otherwise deny). \|allowAndName\| allows download and names files according to<br/>their download guids.<br/>Allowed values: `"deny"`, `"allow"`, `"allowAndName"`, `"default"` |
| `browserContextId`<br/>_optional_ | [BrowserContextID](#browsercontextid) | BrowserContext to set download behavior. When omitted, default browser context is used. |
| `downloadPath`<br/>_optional_ | `string` | The default path to save downloaded files to. This is required if behavior is set to 'allow'<br/>or 'allowAndName'. |
| `eventsEnabled`<br/>_optional_ | `boolean` | Whether to emit download events (defaults to false). |

* **Returns**: None


### <a name="canceldownload"></a>cancelDownload `🧪 experimental`

Cancel a download if in progress

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `guid` | `string` | Global unique identifier of the download. |
| `browserContextId`<br/>_optional_ | [BrowserContextID](#browsercontextid) | BrowserContext to perform the action in. When omitted, default browser context is used. |

* **Returns**: None


### <a name="close"></a>close

Close browser gracefully.

* **Parameters**: None

* **Returns**: None


### <a name="crash"></a>crash `🧪 experimental`

Crashes browser on the main thread.

* **Parameters**: None

* **Returns**: None


### <a name="crashgpuprocess"></a>crashGpuProcess `🧪 experimental`

Crashes GPU process.

* **Parameters**: None

* **Returns**: None


### <a name="getversion"></a>getVersion

Returns version information.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `protocolVersion` | `string` | Protocol version. |
| `product` | `string` | Product name. |
| `revision` | `string` | Product revision. |
| `userAgent` | `string` | User-Agent. |
| `jsVersion` | `string` | V8 version. |


### <a name="getbrowsercommandline"></a>getBrowserCommandLine `🧪 experimental`

Returns the command line switches for the browser process if, and only if
--enable-automation is on the commandline.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `arguments` | array of `string` | Commandline parameters |


### <a name="gethistograms"></a>getHistograms `🧪 experimental`

Get Chrome histograms.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `query`<br/>_optional_ | `string` | Requested substring in name. Only histograms which have query as a<br/>substring in their name are extracted. An empty or absent query returns<br/>all histograms. |
| `delta`<br/>_optional_ | `boolean` | If true, retrieve delta since last delta call. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `histograms` | array of [Histogram](#histogram) | Histograms. |


### <a name="gethistogram"></a>getHistogram `🧪 experimental`

Get a Chrome histogram by name.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Requested histogram name. |
| `delta`<br/>_optional_ | `boolean` | If true, retrieve delta since last delta call. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `histogram` | [Histogram](#histogram) | Histogram. |


### <a name="getwindowbounds"></a>getWindowBounds `🧪 experimental`

Get position and size of the browser window.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `windowId` | [WindowID](#windowid) | Browser window id. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `bounds` | [Bounds](#bounds) | Bounds information of the window. When window state is 'minimized', the restored window<br/>position and size are returned. |


### <a name="getwindowfortarget"></a>getWindowForTarget `🧪 experimental`

Get the browser window that contains the devtools target.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId`<br/>_optional_ | [Target.TargetID](Target.md#targetid) | Devtools agent host id. If called as a part of the session, associated targetId is used. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `windowId` | [WindowID](#windowid) | Browser window id. |
| `bounds` | [Bounds](#bounds) | Bounds information of the window. When window state is 'minimized', the restored window<br/>position and size are returned. |


### <a name="setwindowbounds"></a>setWindowBounds `🧪 experimental`

Set position and/or size of the browser window.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `windowId` | [WindowID](#windowid) | Browser window id. |
| `bounds` | [Bounds](#bounds) | New window bounds. The 'minimized', 'maximized' and 'fullscreen' states cannot be combined<br/>with 'left', 'top', 'width' or 'height'. Leaves unspecified fields unchanged. |

* **Returns**: None


### <a name="setcontentssize"></a>setContentsSize `🧪 experimental`

Set size of the browser contents resizing browser window as necessary.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `windowId` | [WindowID](#windowid) | Browser window id. |
| `width`<br/>_optional_ | `integer` | The window contents width in DIP. Assumes current width if omitted.<br/>Must be specified if 'height' is omitted. |
| `height`<br/>_optional_ | `integer` | The window contents height in DIP. Assumes current height if omitted.<br/>Must be specified if 'width' is omitted. |

* **Returns**: None


### <a name="setdocktile"></a>setDockTile `🧪 experimental`

Set dock tile details, platform-specific.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `badgeLabel`<br/>_optional_ | `string` |  |
| `image`<br/>_optional_ | `string` | Png encoded image. (Encoded as a base64 string when passed over JSON) |

* **Returns**: None


### <a name="executebrowsercommand"></a>executeBrowserCommand `🧪 experimental`

Invoke custom browser commands used by telemetry.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `commandId` | [BrowserCommandId](#browsercommandid) |  |

* **Returns**: None


### <a name="addprivacysandboxenrollmentoverride"></a>addPrivacySandboxEnrollmentOverride

Allows a site to use privacy sandbox features that require enrollment
without the site actually being enrolled. Only supported on page targets.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` |  |

* **Returns**: None


### <a name="addprivacysandboxcoordinatorkeyconfig"></a>addPrivacySandboxCoordinatorKeyConfig

Configures encryption keys used with a given privacy sandbox API to talk
to a trusted coordinator.  Since this is intended for test automation only,
coordinatorOrigin must be a .test domain. No existing coordinator
configuration for the origin may exist.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `api` | [PrivacySandboxAPI](#privacysandboxapi) |  |
| `coordinatorOrigin` | `string` |  |
| `keyConfig` | `string` |  |
| `browserContextId`<br/>_optional_ | [BrowserContextID](#browsercontextid) | BrowserContext to perform the action in. When omitted, default browser<br/>context is used. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="downloadwillbegin"></a>downloadWillBegin `🧪 experimental`

Fired when page is about to start a download.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) | Id of the frame that caused the download to begin. |
| `guid` | `string` | Global unique identifier of the download. |
| `url` | `string` | URL of the resource being downloaded. |
| `suggestedFilename` | `string` | Suggested file name of the resource (the actual name of the file saved on disk may differ). |


### <a name="downloadprogress"></a>downloadProgress `🧪 experimental`

Fired when download makes progress. Last call has |done| == true.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `guid` | `string` | Global unique identifier of the download. |
| `totalBytes` | `number` | Total expected bytes to download. |
| `receivedBytes` | `number` | Total bytes received. |
| `state` | `string` | Download status.<br/>Allowed values: `"inProgress"`, `"completed"`, `"canceled"` |
| `filePath`<br/>_optional_ | `string` | `🧪 experimental` If download is "completed", provides the path of the downloaded file.<br/>Depending on the platform, it is not guaranteed to be set, nor the file<br/>is guaranteed to exist. |


