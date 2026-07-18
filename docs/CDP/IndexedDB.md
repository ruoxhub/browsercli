# IndexedDB

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Runtime](Runtime.md), [Storage](Storage.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="databasewithobjectstores"></a>DatabaseWithObjectStores

Database with an array of object stores.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Database name. |
| `version` | `number` | Database version (type is not 'integer', as the standard<br/>requires the version number to be 'unsigned long long') |
| `objectStores` | array of [ObjectStore](#objectstore) | Object stores in this database. |


### <a name="objectstore"></a>ObjectStore

Object store.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Object store name. |
| `keyPath` | [KeyPath](#keypath) | Object store key path. |
| `autoIncrement` | `boolean` | If true, object store has auto increment flag set. |
| `indexes` | array of [ObjectStoreIndex](#objectstoreindex) | Indexes in this object store. |


### <a name="objectstoreindex"></a>ObjectStoreIndex

Object store index.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Index name. |
| `keyPath` | [KeyPath](#keypath) | Index key path. |
| `unique` | `boolean` | If true, index is unique. |
| `multiEntry` | `boolean` | If true, index allows multiple entries for a key. |


### <a name="key"></a>Key

Key.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Key type.<br/>Allowed values: `"number"`, `"string"`, `"date"`, `"array"` |
| `number`<br/>_optional_ | `number` | Number value. |
| `string`<br/>_optional_ | `string` | String value. |
| `date`<br/>_optional_ | `number` | Date value. |
| `array`<br/>_optional_ | array of [Key](#key) | Array value. |


### <a name="keyrange"></a>KeyRange

Key range.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `lower`<br/>_optional_ | [Key](#key) | Lower bound. |
| `upper`<br/>_optional_ | [Key](#key) | Upper bound. |
| `lowerOpen` | `boolean` | If true lower bound is open. |
| `upperOpen` | `boolean` | If true upper bound is open. |


### <a name="dataentry"></a>DataEntry

Data entry.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | [Runtime.RemoteObject](Runtime.md#remoteobject) | Key object. |
| `primaryKey` | [Runtime.RemoteObject](Runtime.md#remoteobject) | Primary key object. |
| `value` | [Runtime.RemoteObject](Runtime.md#remoteobject) | Value object. |


### <a name="keypath"></a>KeyPath

Key path.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Key path type.<br/>Allowed values: `"null"`, `"string"`, `"array"` |
| `string`<br/>_optional_ | `string` | String value. |
| `array`<br/>_optional_ | array of `string` | Array value. |


---

<a name="commands"></a>
## Commands

### <a name="clearobjectstore"></a>clearObjectStore

Clears all entries from an object store.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.<br/>Security origin. |
| `storageKey`<br/>_optional_ | `string` | Storage key. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket. If not specified, it uses the default bucket. |
| `databaseName` | `string` | Database name. |
| `objectStoreName` | `string` | Object store name. |

* **Returns**: None


### <a name="deletedatabase"></a>deleteDatabase

Deletes a database.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.<br/>Security origin. |
| `storageKey`<br/>_optional_ | `string` | Storage key. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket. If not specified, it uses the default bucket. |
| `databaseName` | `string` | Database name. |

* **Returns**: None


### <a name="deleteobjectstoreentries"></a>deleteObjectStoreEntries

Delete a range of entries from an object store

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.<br/>Security origin. |
| `storageKey`<br/>_optional_ | `string` | Storage key. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket. If not specified, it uses the default bucket. |
| `databaseName` | `string` |  |
| `objectStoreName` | `string` |  |
| `keyRange` | [KeyRange](#keyrange) | Range of entry keys to delete |

* **Returns**: None


### <a name="disable"></a>disable

Disables events from backend.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables events from backend.

* **Parameters**: None

* **Returns**: None


### <a name="requestdata"></a>requestData

Requests data from object store or index.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.<br/>Security origin. |
| `storageKey`<br/>_optional_ | `string` | Storage key. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket. If not specified, it uses the default bucket. |
| `databaseName` | `string` | Database name. |
| `objectStoreName` | `string` | Object store name. |
| `indexName`<br/>_optional_ | `string` | Index name. If not specified, it performs an object store data request. |
| `skipCount` | `integer` | Number of records to skip. |
| `pageSize` | `integer` | Number of records to fetch. |
| `keyRange`<br/>_optional_ | [KeyRange](#keyrange) | Key range. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `objectStoreDataEntries` | array of [DataEntry](#dataentry) | Array of object store data entries. |
| `hasMore` | `boolean` | If true, there are more entries to fetch in the given range. |


### <a name="getmetadata"></a>getMetadata

Gets metadata of an object store.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.<br/>Security origin. |
| `storageKey`<br/>_optional_ | `string` | Storage key. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket. If not specified, it uses the default bucket. |
| `databaseName` | `string` | Database name. |
| `objectStoreName` | `string` | Object store name. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `entriesCount` | `number` | the entries count |
| `keyGeneratorValue` | `number` | the current value of key generator, to become the next inserted<br/>key into the object store. Valid if objectStore.autoIncrement<br/>is true. |


### <a name="requestdatabase"></a>requestDatabase

Requests database with given name in given frame.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.<br/>Security origin. |
| `storageKey`<br/>_optional_ | `string` | Storage key. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket. If not specified, it uses the default bucket. |
| `databaseName` | `string` | Database name. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `databaseWithObjectStores` | [DatabaseWithObjectStores](#databasewithobjectstores) | Database with an array of object stores. |


### <a name="requestdatabasenames"></a>requestDatabaseNames

Requests database names for given security origin.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.<br/>Security origin. |
| `storageKey`<br/>_optional_ | `string` | Storage key. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket. If not specified, it uses the default bucket. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `databaseNames` | array of `string` | Database names for origin. |


---

<a name="events"></a>
## Events

_None_

