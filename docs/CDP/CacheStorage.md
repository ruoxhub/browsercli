# CacheStorage

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Storage](Storage.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="cacheid"></a>CacheId

Unique identifier of the Cache object.

* **Type**: `string`

### <a name="cachedresponsetype"></a>CachedResponseType

type of HTTP response cached

* **Type**: `string`
* **Allowed values**: `"basic"`, `"cors"`, `"default"`, `"error"`, `"opaqueResponse"`, `"opaqueRedirect"`

### <a name="dataentry"></a>DataEntry

Data entry.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `requestURL` | `string` | Request URL. |
| `requestMethod` | `string` | Request method. |
| `requestHeaders` | array of [Header](#header) | Request headers |
| `responseTime` | `number` | Number of seconds since epoch. |
| `responseStatus` | `integer` | HTTP response status code. |
| `responseStatusText` | `string` | HTTP response status text. |
| `responseType` | [CachedResponseType](#cachedresponsetype) | HTTP response type |
| `responseHeaders` | array of [Header](#header) | Response headers |


### <a name="cache"></a>Cache

Cache identifier.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `cacheId` | [CacheId](#cacheid) | An opaque unique id of the cache. |
| `securityOrigin` | `string` | Security origin of the cache. |
| `storageKey` | `string` | Storage key of the cache. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket of the cache. |
| `cacheName` | `string` | The name of the cache. |


### <a name="header"></a>Header

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `value` | `string` |  |


### <a name="cachedresponse"></a>CachedResponse

Cached response

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `body` | `string` | Entry content, base64-encoded. (Encoded as a base64 string when passed over JSON) |


---

<a name="commands"></a>
## Commands

### <a name="deletecache"></a>deleteCache

Deletes a cache.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `cacheId` | [CacheId](#cacheid) | Id of cache for deletion. |

* **Returns**: None


### <a name="deleteentry"></a>deleteEntry

Deletes a cache entry.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `cacheId` | [CacheId](#cacheid) | Id of cache where the entry will be deleted. |
| `request` | `string` | URL spec of the request. |

* **Returns**: None


### <a name="requestcachenames"></a>requestCacheNames

Requests cache names.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityOrigin`<br/>_optional_ | `string` | At least and at most one of securityOrigin, storageKey, storageBucket must be specified.<br/>Security origin. |
| `storageKey`<br/>_optional_ | `string` | Storage key. |
| `storageBucket`<br/>_optional_ | [Storage.StorageBucket](Storage.md#storagebucket) | Storage bucket. If not specified, it uses the default bucket. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `caches` | array of [Cache](#cache) | Caches for the security origin. |


### <a name="requestcachedresponse"></a>requestCachedResponse

Fetches cache entry.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `cacheId` | [CacheId](#cacheid) | Id of cache that contains the entry. |
| `requestURL` | `string` | URL spec of the request. |
| `requestHeaders` | array of [Header](#header) | headers of the request. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `response` | [CachedResponse](#cachedresponse) | Response read from the cache. |


### <a name="requestentries"></a>requestEntries

Requests data from cache.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `cacheId` | [CacheId](#cacheid) | ID of cache to get entries from. |
| `skipCount`<br/>_optional_ | `integer` | Number of records to skip. |
| `pageSize`<br/>_optional_ | `integer` | Number of records to fetch. |
| `pathFilter`<br/>_optional_ | `string` | If present, only return the entries containing this substring in the path |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `cacheDataEntries` | array of [DataEntry](#dataentry) | Array of object store data entries. |
| `returnCount` | `number` | Count of returned entries from this storage. If pathFilter is empty, it<br/>is the count of all entries from this storage. |


---

<a name="events"></a>
## Events

_None_

