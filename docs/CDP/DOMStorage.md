# DOMStorage

`🧪 Experimental`

Query and modify DOM storage.

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

### <a name="serializedstoragekey"></a>SerializedStorageKey

* **Type**: `string`

### <a name="storageid"></a>StorageId

DOM Storage identifier.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | Security origin for the storage. |
| `storageKey`<br/>_optional_ | [SerializedStorageKey](#serializedstoragekey) | Represents a key by which DOM Storage keys its CachedStorageAreas |
| `isLocalStorage` | `boolean` | Whether the storage is local storage (not session storage). |


### <a name="item"></a>Item

DOM Storage item.

* **Type**: `array`

---

<a name="commands"></a>
## Commands

### <a name="clear"></a>clear

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageId` | [StorageId](#storageid) |  |

* **Returns**: None


### <a name="disable"></a>disable

Disables storage tracking, prevents storage events from being sent to the client.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables storage tracking, storage events will now be delivered to the client.

* **Parameters**: None

* **Returns**: None


### <a name="getdomstorageitems"></a>getDOMStorageItems

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageId` | [StorageId](#storageid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `entries` | array of [Item](#item) |  |


### <a name="removedomstorageitem"></a>removeDOMStorageItem

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageId` | [StorageId](#storageid) |  |
| `key` | `string` |  |

* **Returns**: None


### <a name="setdomstorageitem"></a>setDOMStorageItem

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageId` | [StorageId](#storageid) |  |
| `key` | `string` |  |
| `value` | `string` |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="domstorageitemadded"></a>domStorageItemAdded

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageId` | [StorageId](#storageid) |  |
| `key` | `string` |  |
| `newValue` | `string` |  |


### <a name="domstorageitemremoved"></a>domStorageItemRemoved

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageId` | [StorageId](#storageid) |  |
| `key` | `string` |  |


### <a name="domstorageitemupdated"></a>domStorageItemUpdated

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageId` | [StorageId](#storageid) |  |
| `key` | `string` |  |
| `oldValue` | `string` |  |
| `newValue` | `string` |  |


### <a name="domstorageitemscleared"></a>domStorageItemsCleared

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `storageId` | [StorageId](#storageid) |  |


