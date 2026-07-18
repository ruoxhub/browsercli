# Extensions

`🧪 Experimental`

Defines commands and events for browser extensions.

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

### <a name="storagearea"></a>StorageArea

Storage areas.

* **Type**: `string`
* **Allowed values**: `"session"`, `"local"`, `"sync"`, `"managed"`

### <a name="extensioninfo"></a>ExtensionInfo

Detailed information about an extension.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | Extension id. |
| `name` | `string` | Extension name. |
| `version` | `string` | Extension version. |
| `path` | `string` | The path from which the extension was loaded. |
| `enabled` | `boolean` | Extension enabled status. |


---

<a name="commands"></a>
## Commands

### <a name="triggeraction"></a>triggerAction

Runs an extension default action.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | Extension id. |
| `targetId` | `string` | A tab target ID to trigger the default extension action on. |

* **Returns**: None


### <a name="loadunpacked"></a>loadUnpacked

Installs an unpacked extension from the filesystem similar to
--load-extension CLI flags. Returns extension ID once the extension
has been installed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `path` | `string` | Absolute file path. |
| `enableInIncognito`<br/>_optional_ | `boolean` | Enable the extension in incognito |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | Extension id. |


### <a name="getextensions"></a>getExtensions

Gets a list of all unpacked extensions.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `extensions` | array of [ExtensionInfo](#extensioninfo) |  |


### <a name="uninstall"></a>uninstall

Uninstalls an unpacked extension (others not supported) from the profile.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | Extension id. |

* **Returns**: None


### <a name="getstorageitems"></a>getStorageItems

Gets data from extension storage in the given `storageArea`. If `keys` is
specified, these are used to filter the result.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | ID of extension. |
| `storageArea` | [StorageArea](#storagearea) | StorageArea to retrieve data from. |
| `keys`<br/>_optional_ | array of `string` | Keys to retrieve. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `data` | `object` |  |


### <a name="removestorageitems"></a>removeStorageItems

Removes `keys` from extension storage in the given `storageArea`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | ID of extension. |
| `storageArea` | [StorageArea](#storagearea) | StorageArea to remove data from. |
| `keys` | array of `string` | Keys to remove. |

* **Returns**: None


### <a name="clearstorageitems"></a>clearStorageItems

Clears extension storage in the given `storageArea`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | ID of extension. |
| `storageArea` | [StorageArea](#storagearea) | StorageArea to remove data from. |

* **Returns**: None


### <a name="setstorageitems"></a>setStorageItems

Sets `values` in extension storage in the given `storageArea`. The provided `values`
will be merged with existing values in the storage area.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` | ID of extension. |
| `storageArea` | [StorageArea](#storagearea) | StorageArea to set data in. |
| `values` | `object` | Values to set. |

* **Returns**: None


---

<a name="events"></a>
## Events

_None_

