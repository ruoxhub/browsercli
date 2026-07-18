# PWA

`🧪 Experimental`

This domain allows interacting with the browser to control PWAs.

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

### <a name="filehandleraccept"></a>FileHandlerAccept

The following types are the replica of
https://crsrc.org/c/chrome/browser/web_applications/proto/web_app_os_integration_state.proto;drc=9910d3be894c8f142c977ba1023f30a656bc13fc;l=67

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `mediaType` | `string` | New name of the mimetype according to<br/>https://www.iana.org/assignments/media-types/media-types.xhtml |
| `fileExtensions` | array of `string` |  |


### <a name="filehandler"></a>FileHandler

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `action` | `string` |  |
| `accepts` | array of [FileHandlerAccept](#filehandleraccept) |  |
| `displayName` | `string` |  |


### <a name="displaymode"></a>DisplayMode

If user prefers opening the app in browser or an app window.

* **Type**: `string`
* **Allowed values**: `"standalone"`, `"browser"`

---

<a name="commands"></a>
## Commands

### <a name="getosappstate"></a>getOsAppState

Returns the following OS state for the given manifest id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `manifestId` | `string` | The id from the webapp's manifest file, commonly it's the url of the<br/>site installing the webapp. See<br/>https://web.dev/learn/pwa/web-app-manifest. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `badgeCount` | `integer` |  |
| `fileHandlers` | array of [FileHandler](#filehandler) |  |


### <a name="install"></a>install

Installs the given manifest identity, optionally using the given installUrlOrBundleUrl

IWA-specific install description:
manifestId corresponds to isolated-app:// + web_package::SignedWebBundleId

File installation mode:
The installUrlOrBundleUrl can be either file:// or http(s):// pointing
to a signed web bundle (.swbn). In this case SignedWebBundleId must correspond to
The .swbn file's signing key.

Dev proxy installation mode:
installUrlOrBundleUrl must be http(s):// that serves dev mode IWA.
web_package::SignedWebBundleId must be of type dev proxy.

The advantage of dev proxy mode is that all changes to IWA
automatically will be reflected in the running app without
reinstallation.

To generate bundle id for proxy mode:
1. Generate 32 random bytes.
2. Add a specific suffix at the end following the documentation
   https://github.com/WICG/isolated-web-apps/blob/main/Scheme.md#suffix
3. Encode the entire sequence using Base32 without padding.

If Chrome is not in IWA dev
mode, the installation will fail, regardless of the state of the allowlist.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `manifestId` | `string` |  |
| `installUrlOrBundleUrl`<br/>_optional_ | `string` | The location of the app or bundle overriding the one derived from the<br/>manifestId. |

* **Returns**: None


### <a name="uninstall"></a>uninstall

Uninstalls the given manifest_id and closes any opened app windows.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `manifestId` | `string` |  |

* **Returns**: None


### <a name="launch"></a>launch

Launches the installed web app, or an url in the same web app instead of the
default start url if it is provided. Returns a page Target.TargetID which
can be used to attach to via Target.attachToTarget or similar APIs.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `manifestId` | `string` |  |
| `url`<br/>_optional_ | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `targetId` | [Target.TargetID](Target.md#targetid) | ID of the tab target created as a result. |


### <a name="launchfilesinapp"></a>launchFilesInApp

Opens one or more local files from an installed web app identified by its
manifestId. The web app needs to have file handlers registered to process
the files. The API returns one or more page Target.TargetIDs which can be
used to attach to via Target.attachToTarget or similar APIs.
If some files in the parameters cannot be handled by the web app, they will
be ignored. If none of the files can be handled, this API returns an error.
If no files are provided as the parameter, this API also returns an error.

According to the definition of the file handlers in the manifest file, one
Target.TargetID may represent a page handling one or more files. The order
of the returned Target.TargetIDs is not guaranteed.

TODO(crbug.com/339454034): Check the existences of the input files.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `manifestId` | `string` |  |
| `files` | array of `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `targetIds` | array of [Target.TargetID](Target.md#targetid) | IDs of the tab targets created as the result. |


### <a name="opencurrentpageinapp"></a>openCurrentPageInApp

Opens the current page in its web app identified by the manifest id, needs
to be called on a page target. This function returns immediately without
waiting for the app to finish loading.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `manifestId` | `string` |  |

* **Returns**: None


### <a name="changeappusersettings"></a>changeAppUserSettings

Changes user settings of the web app identified by its manifestId. If the
app was not installed, this command returns an error. Unset parameters will
be ignored; unrecognized values will cause an error.

Unlike the ones defined in the manifest files of the web apps, these
settings are provided by the browser and controlled by the users, they
impact the way the browser handling the web apps.

See the comment of each parameter.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `manifestId` | `string` |  |
| `linkCapturing`<br/>_optional_ | `boolean` | If user allows the links clicked on by the user in the app's scope, or<br/>extended scope if the manifest has scope extensions and the flags<br/>`DesktopPWAsLinkCapturingWithScopeExtensions` and<br/>`WebAppEnableScopeExtensions` are enabled.<br/><br/>Note, the API does not support resetting the linkCapturing to the<br/>initial value, uninstalling and installing the web app again will reset<br/>it.<br/><br/>TODO(crbug.com/339453269): Setting this value on ChromeOS is not<br/>supported yet. |
| `displayMode`<br/>_optional_ | [DisplayMode](#displaymode) |  |

* **Returns**: None


---

<a name="events"></a>
## Events

_None_

