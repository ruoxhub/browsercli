# Network

Network domain allows tracking network activities of the page. It exposes information about http,
file, data and other requests and responses, their headers, bodies, timing, etc.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Debugger](Debugger.md), [Runtime](Runtime.md), [Security](Security.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="resourcetype"></a>ResourceType

Resource type as it was perceived by the rendering engine.

* **Type**: `string`
* **Allowed values**: `"Document"`, `"Stylesheet"`, `"Image"`, `"Media"`, `"Font"`, `"Script"`, `"TextTrack"`, `"XHR"`, `"Fetch"`, `"Prefetch"`, `"EventSource"`, `"WebSocket"`, `"Manifest"`, `"SignedExchange"`, `"Ping"`, `"CSPViolationReport"`, `"Preflight"`, `"FedCM"`, `"Other"`

### <a name="loaderid"></a>LoaderId

Unique loader identifier.

* **Type**: `string`

### <a name="requestid"></a>RequestId

Unique network request identifier.
Note that this does not identify individual HTTP requests that are part of
a network request.

* **Type**: `string`

### <a name="interceptionid"></a>InterceptionId

Unique intercepted request identifier.

* **Type**: `string`

### <a name="errorreason"></a>ErrorReason

Network level fetch failure reason.

* **Type**: `string`
* **Allowed values**: `"Failed"`, `"Aborted"`, `"TimedOut"`, `"AccessDenied"`, `"ConnectionClosed"`, `"ConnectionReset"`, `"ConnectionRefused"`, `"ConnectionAborted"`, `"ConnectionFailed"`, `"NameNotResolved"`, `"InternetDisconnected"`, `"AddressUnreachable"`, `"BlockedByClient"`, `"BlockedByResponse"`

### <a name="timesinceepoch"></a>TimeSinceEpoch

UTC time in seconds, counted from January 1, 1970.

* **Type**: `number`

### <a name="monotonictime"></a>MonotonicTime

Monotonically increasing time in seconds since an arbitrary point in the past.

* **Type**: `number`

### <a name="headers"></a>Headers

Request / response headers as keys / values of JSON object.

* **Type**: `object`

### <a name="connectiontype"></a>ConnectionType

The underlying connection technology that the browser is supposedly using.

* **Type**: `string`
* **Allowed values**: `"none"`, `"cellular2g"`, `"cellular3g"`, `"cellular4g"`, `"bluetooth"`, `"ethernet"`, `"wifi"`, `"wimax"`, `"other"`

### <a name="cookiesamesite"></a>CookieSameSite

Represents the cookie's 'SameSite' status:
https://tools.ietf.org/html/draft-west-first-party-cookies

* **Type**: `string`
* **Allowed values**: `"Strict"`, `"Lax"`, `"None"`

### <a name="cookiepriority"></a>CookiePriority `🧪 experimental`

Represents the cookie's 'Priority' status:
https://tools.ietf.org/html/draft-west-cookie-priority-00

* **Type**: `string`
* **Allowed values**: `"Low"`, `"Medium"`, `"High"`

### <a name="cookiesourcescheme"></a>CookieSourceScheme `🧪 experimental`

Represents the source scheme of the origin that originally set the cookie.
A value of "Unset" allows protocol clients to emulate legacy cookie scope for the scheme.
This is a temporary ability and it will be removed in the future.

* **Type**: `string`
* **Allowed values**: `"Unset"`, `"NonSecure"`, `"Secure"`

### <a name="resourcetiming"></a>ResourceTiming

Timing information for the request.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `requestTime` | `number` | Timing's requestTime is a baseline in seconds, while the other numbers are ticks in<br/>milliseconds relatively to this requestTime. |
| `proxyStart` | `number` | Started resolving proxy. |
| `proxyEnd` | `number` | Finished resolving proxy. |
| `dnsStart` | `number` | Started DNS address resolve. |
| `dnsEnd` | `number` | Finished DNS address resolve. |
| `connectStart` | `number` | Started connecting to the remote host. |
| `connectEnd` | `number` | Connected to the remote host. |
| `sslStart` | `number` | Started SSL handshake. |
| `sslEnd` | `number` | Finished SSL handshake. |
| `workerStart` | `number` | `🧪 experimental` Started running ServiceWorker. |
| `workerReady` | `number` | `🧪 experimental` Finished Starting ServiceWorker. |
| `workerFetchStart` | `number` | `🧪 experimental` Started fetch event. |
| `workerRespondWithSettled` | `number` | `🧪 experimental` Settled fetch event respondWith promise. |
| `workerRouterEvaluationStart`<br/>_optional_ | `number` | `🧪 experimental` Started ServiceWorker static routing source evaluation. |
| `workerCacheLookupStart`<br/>_optional_ | `number` | `🧪 experimental` Started cache lookup when the source was evaluated to `cache`. |
| `sendStart` | `number` | Started sending request. |
| `sendEnd` | `number` | Finished sending request. |
| `pushStart` | `number` | `🧪 experimental` Time the server started pushing request. |
| `pushEnd` | `number` | `🧪 experimental` Time the server finished pushing request. |
| `receiveHeadersStart` | `number` | `🧪 experimental` Started receiving response headers. |
| `receiveHeadersEnd` | `number` | Finished receiving response headers. |


### <a name="resourcepriority"></a>ResourcePriority

Loading priority of a resource request.

* **Type**: `string`
* **Allowed values**: `"VeryLow"`, `"Low"`, `"Medium"`, `"High"`, `"VeryHigh"`

### <a name="renderblockingbehavior"></a>RenderBlockingBehavior `🧪 experimental`

The render-blocking behavior of a resource request.

* **Type**: `string`
* **Allowed values**: `"Blocking"`, `"InBodyParserBlocking"`, `"NonBlocking"`, `"NonBlockingDynamic"`, `"PotentiallyBlocking"`

### <a name="postdataentry"></a>PostDataEntry

Post data entry for HTTP request

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `bytes`<br/>_optional_ | `string` |  |


### <a name="request"></a>Request

HTTP request data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Request URL (without fragment). |
| `urlFragment`<br/>_optional_ | `string` | Fragment of the requested URL starting with hash, if present. |
| `method` | `string` | HTTP request method. |
| `headers` | [Headers](#headers) | HTTP request headers. |
| `postData`<br/>_optional_ | `string` | `⚠️ deprecated` HTTP POST request data.<br/>Use postDataEntries instead. |
| `hasPostData`<br/>_optional_ | `boolean` | True when the request has POST data. Note that postData might still be omitted when this flag is true when the data is too long. |
| `postDataEntries`<br/>_optional_ | array of [PostDataEntry](#postdataentry) | `🧪 experimental` Request body elements (post data broken into individual entries). |
| `mixedContentType`<br/>_optional_ | [Security.MixedContentType](Security.md#mixedcontenttype) | The mixed content type of the request. |
| `initialPriority` | [ResourcePriority](#resourcepriority) | Priority of the resource request at the time request is sent. |
| `referrerPolicy` | `string` | The referrer policy of the request, as defined in https://www.w3.org/TR/referrer-policy/<br/>Allowed values: `"unsafe-url"`, `"no-referrer-when-downgrade"`, `"no-referrer"`, `"origin"`, `"origin-when-cross-origin"`, `"same-origin"`, `"strict-origin"`, `"strict-origin-when-cross-origin"` |
| `isLinkPreload`<br/>_optional_ | `boolean` | Whether is loaded via link preload. |
| `trustTokenParams`<br/>_optional_ | [TrustTokenParams](#trusttokenparams) | `🧪 experimental` Set for requests when the TrustToken API is used. Contains the parameters<br/>passed by the developer (e.g. via "fetch") as understood by the backend. |
| `isSameSite`<br/>_optional_ | `boolean` | `🧪 experimental` True if this resource request is considered to be the 'same site' as the<br/>request corresponding to the main frame. |
| `isAdRelated`<br/>_optional_ | `boolean` | `🧪 experimental` True when the resource request is ad-related. |


### <a name="signedcertificatetimestamp"></a>SignedCertificateTimestamp

Details of a signed certificate timestamp (SCT).

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `status` | `string` | Validation status. |
| `origin` | `string` | Origin. |
| `logDescription` | `string` | Log name / description. |
| `logId` | `string` | Log ID. |
| `timestamp` | `number` | Issuance date. Unlike TimeSinceEpoch, this contains the number of<br/>milliseconds since January 1, 1970, UTC, not the number of seconds. |
| `hashAlgorithm` | `string` | Hash algorithm. |
| `signatureAlgorithm` | `string` | Signature algorithm. |
| `signatureData` | `string` | Signature data. |


### <a name="securitydetails"></a>SecurityDetails

Security details about a request.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `protocol` | `string` | Protocol name (e.g. "TLS 1.2" or "QUIC"). |
| `keyExchange` | `string` | Key Exchange used by the connection, or the empty string if not applicable. |
| `keyExchangeGroup`<br/>_optional_ | `string` | (EC)DH group used by the connection, if applicable. |
| `cipher` | `string` | Cipher name. |
| `mac`<br/>_optional_ | `string` | TLS MAC. Note that AEAD ciphers do not have separate MACs. |
| `certificateId` | [Security.CertificateId](Security.md#certificateid) | Certificate ID value. |
| `subjectName` | `string` | Certificate subject name. |
| `sanList` | array of `string` | Subject Alternative Name (SAN) DNS names and IP addresses. |
| `issuer` | `string` | Name of the issuing CA. |
| `validFrom` | [TimeSinceEpoch](#timesinceepoch) | Certificate valid from date. |
| `validTo` | [TimeSinceEpoch](#timesinceepoch) | Certificate valid to (expiration) date |
| `signedCertificateTimestampList` | array of [SignedCertificateTimestamp](#signedcertificatetimestamp) | List of signed certificate timestamps (SCTs). |
| `certificateTransparencyCompliance` | [CertificateTransparencyCompliance](#certificatetransparencycompliance) | Whether the request complied with Certificate Transparency policy |
| `serverSignatureAlgorithm`<br/>_optional_ | `integer` | The signature algorithm used by the server in the TLS server signature,<br/>represented as a TLS SignatureScheme code point. Omitted if not<br/>applicable or not known. |
| `encryptedClientHello` | `boolean` | Whether the connection used Encrypted ClientHello |


### <a name="certificatetransparencycompliance"></a>CertificateTransparencyCompliance

Whether the request complied with Certificate Transparency policy.

* **Type**: `string`
* **Allowed values**: `"unknown"`, `"not-compliant"`, `"compliant"`

### <a name="blockedreason"></a>BlockedReason

The reason why request was blocked.

* **Type**: `string`
* **Allowed values**: `"other"`, `"csp"`, `"mixed-content"`, `"origin"`, `"inspector"`, `"integrity"`, `"subresource-filter"`, `"content-type"`, `"coep-frame-resource-needs-coep-header"`, `"coop-sandboxed-iframe-cannot-navigate-to-coop-page"`, `"corp-not-same-origin"`, `"corp-not-same-origin-after-defaulted-to-same-origin-by-coep"`, `"corp-not-same-origin-after-defaulted-to-same-origin-by-dip"`, `"corp-not-same-origin-after-defaulted-to-same-origin-by-coep-and-dip"`, `"corp-not-same-site"`, `"sri-message-signature-mismatch"`

### <a name="corserror"></a>CorsError

The reason why request was blocked.

* **Type**: `string`
* **Allowed values**: `"DisallowedByMode"`, `"InvalidResponse"`, `"WildcardOriginNotAllowed"`, `"MissingAllowOriginHeader"`, `"MultipleAllowOriginValues"`, `"InvalidAllowOriginValue"`, `"AllowOriginMismatch"`, `"InvalidAllowCredentials"`, `"CorsDisabledScheme"`, `"PreflightInvalidStatus"`, `"PreflightDisallowedRedirect"`, `"PreflightWildcardOriginNotAllowed"`, `"PreflightMissingAllowOriginHeader"`, `"PreflightMultipleAllowOriginValues"`, `"PreflightInvalidAllowOriginValue"`, `"PreflightAllowOriginMismatch"`, `"PreflightInvalidAllowCredentials"`, `"PreflightMissingAllowExternal"`, `"PreflightInvalidAllowExternal"`, `"InvalidAllowMethodsPreflightResponse"`, `"InvalidAllowHeadersPreflightResponse"`, `"MethodDisallowedByPreflightResponse"`, `"HeaderDisallowedByPreflightResponse"`, `"RedirectContainsCredentials"`, `"InsecureLocalNetwork"`, `"InvalidLocalNetworkAccess"`, `"NoCorsRedirectModeNotFollow"`, `"LocalNetworkAccessPermissionDenied"`

### <a name="corserrorstatus"></a>CorsErrorStatus

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `corsError` | [CorsError](#corserror) |  |
| `failedParameter` | `string` |  |


### <a name="serviceworkerresponsesource"></a>ServiceWorkerResponseSource

Source of serviceworker response.

* **Type**: `string`
* **Allowed values**: `"cache-storage"`, `"http-cache"`, `"fallback-code"`, `"network"`

### <a name="trusttokenparams"></a>TrustTokenParams `🧪 experimental`

Determines what type of Trust Token operation is executed and
depending on the type, some additional parameters. The values
are specified in third_party/blink/renderer/core/fetch/trust_token.idl.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `operation` | [TrustTokenOperationType](#trusttokenoperationtype) |  |
| `refreshPolicy` | `string` | Only set for "token-redemption" operation and determine whether<br/>to request a fresh SRR or use a still valid cached SRR.<br/>Allowed values: `"UseCached"`, `"Refresh"` |
| `issuers`<br/>_optional_ | array of `string` | Origins of issuers from whom to request tokens or redemption<br/>records. |


### <a name="trusttokenoperationtype"></a>TrustTokenOperationType `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"Issuance"`, `"Redemption"`, `"Signing"`

### <a name="alternateprotocolusage"></a>AlternateProtocolUsage `🧪 experimental`

The reason why Chrome uses a specific transport protocol for HTTP semantics.

* **Type**: `string`
* **Allowed values**: `"alternativeJobWonWithoutRace"`, `"alternativeJobWonRace"`, `"mainJobWonRace"`, `"mappingMissing"`, `"broken"`, `"dnsAlpnH3JobWonWithoutRace"`, `"dnsAlpnH3JobWonRace"`, `"unspecifiedReason"`

### <a name="serviceworkerroutersource"></a>ServiceWorkerRouterSource

Source of service worker router.

* **Type**: `string`
* **Allowed values**: `"network"`, `"cache"`, `"fetch-event"`, `"race-network-and-fetch-handler"`, `"race-network-and-cache"`

### <a name="serviceworkerrouterinfo"></a>ServiceWorkerRouterInfo `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `ruleIdMatched`<br/>_optional_ | `integer` | ID of the rule matched. If there is a matched rule, this field will<br/>be set, otherwiser no value will be set. |
| `matchedSourceType`<br/>_optional_ | [ServiceWorkerRouterSource](#serviceworkerroutersource) | The router source of the matched rule. If there is a matched rule, this<br/>field will be set, otherwise no value will be set. |
| `actualSourceType`<br/>_optional_ | [ServiceWorkerRouterSource](#serviceworkerroutersource) | The actual router source used. |


### <a name="response"></a>Response

HTTP response data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Response URL. This URL can be different from CachedResource.url in case of redirect. |
| `status` | `integer` | HTTP response status code. |
| `statusText` | `string` | HTTP response status text. |
| `headers` | [Headers](#headers) | HTTP response headers. |
| `headersText`<br/>_optional_ | `string` | `⚠️ deprecated` HTTP response headers text. This has been replaced by the headers in Network.responseReceivedExtraInfo. |
| `mimeType` | `string` | Resource mimeType as determined by the browser. |
| `charset` | `string` | Resource charset as determined by the browser (if applicable). |
| `requestHeaders`<br/>_optional_ | [Headers](#headers) | Refined HTTP request headers that were actually transmitted over the network. |
| `requestHeadersText`<br/>_optional_ | `string` | `⚠️ deprecated` HTTP request headers text. This has been replaced by the headers in Network.requestWillBeSentExtraInfo. |
| `connectionReused` | `boolean` | Specifies whether physical connection was actually reused for this request. |
| `connectionId` | `number` | Physical connection id that was actually used for this request. |
| `remoteIPAddress`<br/>_optional_ | `string` | Remote IP address. |
| `remotePort`<br/>_optional_ | `integer` | Remote port. |
| `fromDiskCache`<br/>_optional_ | `boolean` | Specifies that the request was served from the disk cache. |
| `fromServiceWorker`<br/>_optional_ | `boolean` | Specifies that the request was served from the ServiceWorker. |
| `fromPrefetchCache`<br/>_optional_ | `boolean` | Specifies that the request was served from the prefetch cache. |
| `fromEarlyHints`<br/>_optional_ | `boolean` | Specifies that the request was served from the prefetch cache. |
| `serviceWorkerRouterInfo`<br/>_optional_ | [ServiceWorkerRouterInfo](#serviceworkerrouterinfo) | `🧪 experimental` Information about how ServiceWorker Static Router API was used. If this<br/>field is set with `matchedSourceType` field, a matching rule is found.<br/>If this field is set without `matchedSource`, no matching rule is found.<br/>Otherwise, the API is not used. |
| `encodedDataLength` | `number` | Total number of bytes received for this request so far. |
| `timing`<br/>_optional_ | [ResourceTiming](#resourcetiming) | Timing information for the given request. |
| `serviceWorkerResponseSource`<br/>_optional_ | [ServiceWorkerResponseSource](#serviceworkerresponsesource) | Response source of response from ServiceWorker. |
| `responseTime`<br/>_optional_ | [TimeSinceEpoch](#timesinceepoch) | The time at which the returned response was generated. |
| `cacheStorageCacheName`<br/>_optional_ | `string` | Cache Storage Cache Name. |
| `protocol`<br/>_optional_ | `string` | Protocol used to fetch this request. |
| `alternateProtocolUsage`<br/>_optional_ | [AlternateProtocolUsage](#alternateprotocolusage) | `🧪 experimental` The reason why Chrome uses a specific transport protocol for HTTP semantics. |
| `securityState` | [Security.SecurityState](Security.md#securitystate) | Security state of the request resource. |
| `securityDetails`<br/>_optional_ | [SecurityDetails](#securitydetails) | Security details for the request. |


### <a name="websocketrequest"></a>WebSocketRequest

WebSocket request data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `headers` | [Headers](#headers) | HTTP request headers. |


### <a name="websocketresponse"></a>WebSocketResponse

WebSocket response data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `status` | `integer` | HTTP response status code. |
| `statusText` | `string` | HTTP response status text. |
| `headers` | [Headers](#headers) | HTTP response headers. |
| `headersText`<br/>_optional_ | `string` | HTTP response headers text. |
| `requestHeaders`<br/>_optional_ | [Headers](#headers) | HTTP request headers. |
| `requestHeadersText`<br/>_optional_ | `string` | HTTP request headers text. |


### <a name="websocketframe"></a>WebSocketFrame

WebSocket message data. This represents an entire WebSocket message, not just a fragmented frame as the name suggests.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `opcode` | `number` | WebSocket message opcode. |
| `mask` | `boolean` | WebSocket message mask. |
| `payloadData` | `string` | WebSocket message payload data.<br/>If the opcode is 1, this is a text message and payloadData is a UTF-8 string.<br/>If the opcode isn't 1, then payloadData is a base64 encoded string representing binary data. |


### <a name="cachedresource"></a>CachedResource

Information about the cached resource.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Resource URL. This is the url of the original network request. |
| `type` | [ResourceType](#resourcetype) | Type of this resource. |
| `response`<br/>_optional_ | [Response](#response) | Cached response data. |
| `bodySize` | `number` | Cached response body size. |


### <a name="initiator"></a>Initiator

Information about the request initiator.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | Type of this initiator.<br/>Allowed values: `"parser"`, `"script"`, `"preload"`, `"SignedExchange"`, `"preflight"`, `"FedCM"`, `"other"` |
| `stack`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | Initiator JavaScript stack trace, set for Script only.<br/>Requires the Debugger domain to be enabled. |
| `url`<br/>_optional_ | `string` | Initiator URL, set for Parser type or for Script type (when script is importing module) or for SignedExchange type. |
| `lineNumber`<br/>_optional_ | `number` | Initiator line number, set for Parser type or for Script type (when script is importing<br/>module) (0-based). |
| `columnNumber`<br/>_optional_ | `number` | Initiator column number, set for Parser type or for Script type (when script is importing<br/>module) (0-based). |
| `requestId`<br/>_optional_ | [RequestId](#requestid) | Set if another request triggered this request (e.g. preflight). |


### <a name="cookiepartitionkey"></a>CookiePartitionKey `🧪 experimental`

cookiePartitionKey object
The representation of the components of the key that are created by the cookiePartitionKey class contained in net/cookies/cookie_partition_key.h.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `topLevelSite` | `string` | The site of the top-level URL the browser was visiting at the start<br/>of the request to the endpoint that set the cookie. |
| `hasCrossSiteAncestor` | `boolean` | Indicates if the cookie has any ancestors that are cross-site to the topLevelSite. |


### <a name="cookie"></a>Cookie

Cookie object

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Cookie name. |
| `value` | `string` | Cookie value. |
| `domain` | `string` | Cookie domain. |
| `path` | `string` | Cookie path. |
| `expires` | `number` | Cookie expiration date as the number of seconds since the UNIX epoch.<br/>The value is set to -1 if the expiry date is not set.<br/>The value can be null for values that cannot be represented in<br/>JSON (±Inf). |
| `size` | `integer` | Cookie size. |
| `httpOnly` | `boolean` | True if cookie is http-only. |
| `secure` | `boolean` | True if cookie is secure. |
| `session` | `boolean` | True in case of session cookie. |
| `sameSite`<br/>_optional_ | [CookieSameSite](#cookiesamesite) | Cookie SameSite type. |
| `priority` | [CookiePriority](#cookiepriority) | `🧪 experimental` Cookie Priority |
| `sourceScheme` | [CookieSourceScheme](#cookiesourcescheme) | `🧪 experimental` Cookie source scheme type. |
| `sourcePort` | `integer` | `🧪 experimental` Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.<br/>An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.<br/>This is a temporary ability and it will be removed in the future. |
| `partitionKey`<br/>_optional_ | [CookiePartitionKey](#cookiepartitionkey) | `🧪 experimental` Cookie partition key. |
| `partitionKeyOpaque`<br/>_optional_ | `boolean` | `🧪 experimental` True if cookie partition key is opaque. |


### <a name="setcookieblockedreason"></a>SetCookieBlockedReason `🧪 experimental`

Types of reasons why a cookie may not be stored from a response.

* **Type**: `string`
* **Allowed values**: `"SecureOnly"`, `"SameSiteStrict"`, `"SameSiteLax"`, `"SameSiteUnspecifiedTreatedAsLax"`, `"SameSiteNoneInsecure"`, `"UserPreferences"`, `"ThirdPartyPhaseout"`, `"ThirdPartyBlockedInFirstPartySet"`, `"SyntaxError"`, `"SchemeNotSupported"`, `"OverwriteSecure"`, `"InvalidDomain"`, `"InvalidPrefix"`, `"UnknownError"`, `"SchemefulSameSiteStrict"`, `"SchemefulSameSiteLax"`, `"SchemefulSameSiteUnspecifiedTreatedAsLax"`, `"NameValuePairExceedsMaxSize"`, `"DisallowedCharacter"`, `"NoCookieContent"`

### <a name="cookieblockedreason"></a>CookieBlockedReason `🧪 experimental`

Types of reasons why a cookie may not be sent with a request.

* **Type**: `string`
* **Allowed values**: `"SecureOnly"`, `"NotOnPath"`, `"DomainMismatch"`, `"SameSiteStrict"`, `"SameSiteLax"`, `"SameSiteUnspecifiedTreatedAsLax"`, `"SameSiteNoneInsecure"`, `"UserPreferences"`, `"ThirdPartyPhaseout"`, `"ThirdPartyBlockedInFirstPartySet"`, `"UnknownError"`, `"SchemefulSameSiteStrict"`, `"SchemefulSameSiteLax"`, `"SchemefulSameSiteUnspecifiedTreatedAsLax"`, `"NameValuePairExceedsMaxSize"`, `"PortMismatch"`, `"SchemeMismatch"`, `"AnonymousContext"`

### <a name="cookieexemptionreason"></a>CookieExemptionReason `🧪 experimental`

Types of reasons why a cookie should have been blocked by 3PCD but is exempted for the request.

* **Type**: `string`
* **Allowed values**: `"None"`, `"UserSetting"`, `"EnterprisePolicy"`, `"StorageAccess"`, `"TopLevelStorageAccess"`, `"Scheme"`, `"SameSiteNoneCookiesInSandbox"`

### <a name="blockedsetcookiewithreason"></a>BlockedSetCookieWithReason `🧪 experimental`

A cookie which was not stored from a response with the corresponding reason.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `blockedReasons` | array of [SetCookieBlockedReason](#setcookieblockedreason) | The reason(s) this cookie was blocked. |
| `cookieLine` | `string` | The string representing this individual cookie as it would appear in the header.<br/>This is not the entire "cookie" or "set-cookie" header which could have multiple cookies. |
| `cookie`<br/>_optional_ | [Cookie](#cookie) | The cookie object which represents the cookie which was not stored. It is optional because<br/>sometimes complete cookie information is not available, such as in the case of parsing<br/>errors. |


### <a name="exemptedsetcookiewithreason"></a>ExemptedSetCookieWithReason `🧪 experimental`

A cookie should have been blocked by 3PCD but is exempted and stored from a response with the
corresponding reason. A cookie could only have at most one exemption reason.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `exemptionReason` | [CookieExemptionReason](#cookieexemptionreason) | The reason the cookie was exempted. |
| `cookieLine` | `string` | The string representing this individual cookie as it would appear in the header. |
| `cookie` | [Cookie](#cookie) | The cookie object representing the cookie. |


### <a name="associatedcookie"></a>AssociatedCookie `🧪 experimental`

A cookie associated with the request which may or may not be sent with it.
Includes the cookies itself and reasons for blocking or exemption.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `cookie` | [Cookie](#cookie) | The cookie object representing the cookie which was not sent. |
| `blockedReasons` | array of [CookieBlockedReason](#cookieblockedreason) | The reason(s) the cookie was blocked. If empty means the cookie is included. |
| `exemptionReason`<br/>_optional_ | [CookieExemptionReason](#cookieexemptionreason) | The reason the cookie should have been blocked by 3PCD but is exempted. A cookie could<br/>only have at most one exemption reason. |


### <a name="cookieparam"></a>CookieParam

Cookie parameter object

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Cookie name. |
| `value` | `string` | Cookie value. |
| `url`<br/>_optional_ | `string` | The request-URI to associate with the setting of the cookie. This value can affect the<br/>default domain, path, source port, and source scheme values of the created cookie. |
| `domain`<br/>_optional_ | `string` | Cookie domain. |
| `path`<br/>_optional_ | `string` | Cookie path. |
| `secure`<br/>_optional_ | `boolean` | True if cookie is secure. |
| `httpOnly`<br/>_optional_ | `boolean` | True if cookie is http-only. |
| `sameSite`<br/>_optional_ | [CookieSameSite](#cookiesamesite) | Cookie SameSite type. |
| `expires`<br/>_optional_ | [TimeSinceEpoch](#timesinceepoch) | Cookie expiration date, session cookie if not set |
| `priority`<br/>_optional_ | [CookiePriority](#cookiepriority) | `🧪 experimental` Cookie Priority. |
| `sourceScheme`<br/>_optional_ | [CookieSourceScheme](#cookiesourcescheme) | `🧪 experimental` Cookie source scheme type. |
| `sourcePort`<br/>_optional_ | `integer` | `🧪 experimental` Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.<br/>An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.<br/>This is a temporary ability and it will be removed in the future. |
| `partitionKey`<br/>_optional_ | [CookiePartitionKey](#cookiepartitionkey) | `🧪 experimental` Cookie partition key. If not set, the cookie will be set as not partitioned. |


### <a name="authchallenge"></a>AuthChallenge `🧪 experimental`

Authorization challenge for HTTP status code 401 or 407.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `source`<br/>_optional_ | `string` | Source of the authentication challenge.<br/>Allowed values: `"Server"`, `"Proxy"` |
| `origin` | `string` | Origin of the challenger. |
| `scheme` | `string` | The authentication scheme used, such as basic or digest |
| `realm` | `string` | The realm of the challenge. May be empty. |


### <a name="authchallengeresponse"></a>AuthChallengeResponse `🧪 experimental`

Response to an AuthChallenge.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `response` | `string` | The decision on what to do in response to the authorization challenge.  Default means<br/>deferring to the default behavior of the net stack, which will likely either the Cancel<br/>authentication or display a popup dialog box.<br/>Allowed values: `"Default"`, `"CancelAuth"`, `"ProvideCredentials"` |
| `username`<br/>_optional_ | `string` | The username to provide, possibly empty. Should only be set if response is<br/>ProvideCredentials. |
| `password`<br/>_optional_ | `string` | The password to provide, possibly empty. Should only be set if response is<br/>ProvideCredentials. |


### <a name="interceptionstage"></a>InterceptionStage `🧪 experimental`

Stages of the interception to begin intercepting. Request will intercept before the request is
sent. Response will intercept after the response is received.

* **Type**: `string`
* **Allowed values**: `"Request"`, `"HeadersReceived"`

### <a name="requestpattern"></a>RequestPattern `🧪 experimental`

Request pattern for interception.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `urlPattern`<br/>_optional_ | `string` | Wildcards (`'*'` -> zero or more, `'?'` -> exactly one) are allowed. Escape character is<br/>backslash. Omitting is equivalent to `"*"`. |
| `resourceType`<br/>_optional_ | [ResourceType](#resourcetype) | If set, only requests for matching resource types will be intercepted. |
| `interceptionStage`<br/>_optional_ | [InterceptionStage](#interceptionstage) | Stage at which to begin intercepting requests. Default is Request. |


### <a name="signedexchangesignature"></a>SignedExchangeSignature `🧪 experimental`

Information about a signed exchange signature.
https://wicg.github.io/webpackage/draft-yasskin-httpbis-origin-signed-exchanges-impl.html#rfc.section.3.1

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `label` | `string` | Signed exchange signature label. |
| `signature` | `string` | The hex string of signed exchange signature. |
| `integrity` | `string` | Signed exchange signature integrity. |
| `certUrl`<br/>_optional_ | `string` | Signed exchange signature cert Url. |
| `certSha256`<br/>_optional_ | `string` | The hex string of signed exchange signature cert sha256. |
| `validityUrl` | `string` | Signed exchange signature validity Url. |
| `date` | `integer` | Signed exchange signature date. |
| `expires` | `integer` | Signed exchange signature expires. |
| `certificates`<br/>_optional_ | array of `string` | The encoded certificates. |


### <a name="signedexchangeheader"></a>SignedExchangeHeader `🧪 experimental`

Information about a signed exchange header.
https://wicg.github.io/webpackage/draft-yasskin-httpbis-origin-signed-exchanges-impl.html#cbor-representation

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `requestUrl` | `string` | Signed exchange request URL. |
| `responseCode` | `integer` | Signed exchange response code. |
| `responseHeaders` | [Headers](#headers) | Signed exchange response headers. |
| `signatures` | array of [SignedExchangeSignature](#signedexchangesignature) | Signed exchange response signature. |
| `headerIntegrity` | `string` | Signed exchange header integrity hash in the form of `sha256-<base64-hash-value>`. |


### <a name="signedexchangeerrorfield"></a>SignedExchangeErrorField `🧪 experimental`

Field type for a signed exchange related error.

* **Type**: `string`
* **Allowed values**: `"signatureSig"`, `"signatureIntegrity"`, `"signatureCertUrl"`, `"signatureCertSha256"`, `"signatureValidityUrl"`, `"signatureTimestamps"`

### <a name="signedexchangeerror"></a>SignedExchangeError `🧪 experimental`

Information about a signed exchange response.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `message` | `string` | Error message. |
| `signatureIndex`<br/>_optional_ | `integer` | The index of the signature which caused the error. |
| `errorField`<br/>_optional_ | [SignedExchangeErrorField](#signedexchangeerrorfield) | The field which caused the error. |


### <a name="signedexchangeinfo"></a>SignedExchangeInfo `🧪 experimental`

Information about a signed exchange response.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `outerResponse` | [Response](#response) | The outer response of signed HTTP exchange which was received from network. |
| `hasExtraInfo` | `boolean` | Whether network response for the signed exchange was accompanied by<br/>extra headers. |
| `header`<br/>_optional_ | [SignedExchangeHeader](#signedexchangeheader) | Information about the signed exchange header. |
| `securityDetails`<br/>_optional_ | [SecurityDetails](#securitydetails) | Security details for the signed exchange header. |
| `errors`<br/>_optional_ | array of [SignedExchangeError](#signedexchangeerror) | Errors occurred while handling the signed exchange. |


### <a name="contentencoding"></a>ContentEncoding `🧪 experimental`

List of content encodings supported by the backend.

* **Type**: `string`
* **Allowed values**: `"deflate"`, `"gzip"`, `"br"`, `"zstd"`

### <a name="networkconditions"></a>NetworkConditions `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `urlPattern` | `string` | Only matching requests will be affected by these conditions. Patterns use the URLPattern constructor string<br/>syntax (https://urlpattern.spec.whatwg.org/) and must be absolute. If the pattern is empty, all requests are<br/>matched (including p2p connections). |
| `latency` | `number` | Minimum latency from request sent to response headers received (ms). |
| `downloadThroughput` | `number` | Maximal aggregated download throughput (bytes/sec). -1 disables download throttling. |
| `uploadThroughput` | `number` | Maximal aggregated upload throughput (bytes/sec).  -1 disables upload throttling. |
| `connectionType`<br/>_optional_ | [ConnectionType](#connectiontype) | Connection type if known. |
| `packetLoss`<br/>_optional_ | `number` | WebRTC packet loss (percent, 0-100). 0 disables packet loss emulation, 100 drops all the packets. |
| `packetQueueLength`<br/>_optional_ | `integer` | WebRTC packet queue length (packet). 0 removes any queue length limitations. |
| `packetReordering`<br/>_optional_ | `boolean` | WebRTC packetReordering feature. |
| `offline`<br/>_optional_ | `boolean` | True to emulate internet disconnection. |


### <a name="blockpattern"></a>BlockPattern `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `urlPattern` | `string` | URL pattern to match. Patterns use the URLPattern constructor string syntax<br/>(https://urlpattern.spec.whatwg.org/) and must be absolute. Example: `*://*:*/*.css`. |
| `block` | `boolean` | Whether or not to block the pattern. If false, a matching request will not be blocked even if it matches a later<br/>`BlockPattern`. |


### <a name="directsocketdnsquerytype"></a>DirectSocketDnsQueryType `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"ipv4"`, `"ipv6"`

### <a name="directtcpsocketoptions"></a>DirectTCPSocketOptions `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `noDelay` | `boolean` | TCP_NODELAY option |
| `keepAliveDelay`<br/>_optional_ | `number` | Expected to be unsigned integer. |
| `sendBufferSize`<br/>_optional_ | `number` | Expected to be unsigned integer. |
| `receiveBufferSize`<br/>_optional_ | `number` | Expected to be unsigned integer. |
| `dnsQueryType`<br/>_optional_ | [DirectSocketDnsQueryType](#directsocketdnsquerytype) |  |


### <a name="directudpsocketoptions"></a>DirectUDPSocketOptions `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `remoteAddr`<br/>_optional_ | `string` |  |
| `remotePort`<br/>_optional_ | `integer` | Unsigned int 16. |
| `localAddr`<br/>_optional_ | `string` |  |
| `localPort`<br/>_optional_ | `integer` | Unsigned int 16. |
| `dnsQueryType`<br/>_optional_ | [DirectSocketDnsQueryType](#directsocketdnsquerytype) |  |
| `sendBufferSize`<br/>_optional_ | `number` | Expected to be unsigned integer. |
| `receiveBufferSize`<br/>_optional_ | `number` | Expected to be unsigned integer. |
| `multicastLoopback`<br/>_optional_ | `boolean` |  |
| `multicastTimeToLive`<br/>_optional_ | `integer` | Unsigned int 8. |
| `multicastAllowAddressSharing`<br/>_optional_ | `boolean` |  |


### <a name="directudpmessage"></a>DirectUDPMessage `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `data` | `string` |  |
| `remoteAddr`<br/>_optional_ | `string` | Null for connected mode. |
| `remotePort`<br/>_optional_ | `integer` | Null for connected mode.<br/>Expected to be unsigned integer. |


### <a name="localnetworkaccessrequestpolicy"></a>LocalNetworkAccessRequestPolicy `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"Allow"`, `"BlockFromInsecureToMorePrivate"`, `"WarnFromInsecureToMorePrivate"`, `"PermissionBlock"`, `"PermissionWarn"`

### <a name="ipaddressspace"></a>IPAddressSpace `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"Loopback"`, `"Local"`, `"Public"`, `"Unknown"`

### <a name="connecttiming"></a>ConnectTiming `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `requestTime` | `number` | Timing's requestTime is a baseline in seconds, while the other numbers are ticks in<br/>milliseconds relatively to this requestTime. Matches ResourceTiming's requestTime for<br/>the same request (but not for redirected requests). |


### <a name="clientsecuritystate"></a>ClientSecurityState `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `initiatorIsSecureContext` | `boolean` |  |
| `initiatorIPAddressSpace` | [IPAddressSpace](#ipaddressspace) |  |
| `localNetworkAccessRequestPolicy` | [LocalNetworkAccessRequestPolicy](#localnetworkaccessrequestpolicy) |  |


### <a name="adscriptidentifier"></a>AdScriptIdentifier `🧪 experimental`

Identifies the script on the stack that caused a resource or element to be
labeled as an ad. For resources, this indicates the context that triggered
the fetch. For elements, this indicates the context that caused the element
to be appended to the DOM.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | The script's V8 identifier. |
| `debuggerId` | [Runtime.UniqueDebuggerId](Runtime.md#uniquedebuggerid) | V8's debugging ID for the v8::Context. |
| `name` | `string` | The script's url (or generated name based on id if inline script). |


### <a name="adancestry"></a>AdAncestry `🧪 experimental`

Encapsulates the script ancestry and the root script filter list rule that
caused the resource or element to be labeled as an ad.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `ancestryChain` | array of [AdScriptIdentifier](#adscriptidentifier) | A chain of `AdScriptIdentifier`s representing the ancestry of an ad<br/>script that led to the creation of a resource or element. The chain is<br/>ordered from the script itself (lowest level) up to its root ancestor<br/>that was flagged by a filter list. |
| `rootScriptFilterlistRule`<br/>_optional_ | `string` | The filter list rule that caused the root (last) script in<br/>`ancestryChain` to be tagged as an ad. |


### <a name="adprovenance"></a>AdProvenance `🧪 experimental`

Represents the provenance of an ad resource or element. Only one of
`filterlistRule` or `adScriptAncestry` can be set. If `filterlistRule`
is provided, the resource URL directly matches a filter list rule. If
`adScriptAncestry` is provided, an ad script initiated the resource fetch or
appended the element to the DOM. If neither is provided, the entity is
known to be an ad, but provenance tracking information is unavailable.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `filterlistRule`<br/>_optional_ | `string` | The filterlist rule that matched, if any. |
| `adScriptAncestry`<br/>_optional_ | [AdAncestry](#adancestry) | The script ancestry that created the ad, if any. |


### <a name="crossoriginopenerpolicyvalue"></a>CrossOriginOpenerPolicyValue `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"SameOrigin"`, `"SameOriginAllowPopups"`, `"RestrictProperties"`, `"UnsafeNone"`, `"SameOriginPlusCoep"`, `"RestrictPropertiesPlusCoep"`, `"NoopenerAllowPopups"`

### <a name="crossoriginopenerpolicystatus"></a>CrossOriginOpenerPolicyStatus `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `value` | [CrossOriginOpenerPolicyValue](#crossoriginopenerpolicyvalue) |  |
| `reportOnlyValue` | [CrossOriginOpenerPolicyValue](#crossoriginopenerpolicyvalue) |  |
| `reportingEndpoint`<br/>_optional_ | `string` |  |
| `reportOnlyReportingEndpoint`<br/>_optional_ | `string` |  |


### <a name="crossoriginembedderpolicyvalue"></a>CrossOriginEmbedderPolicyValue `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"None"`, `"Credentialless"`, `"RequireCorp"`

### <a name="crossoriginembedderpolicystatus"></a>CrossOriginEmbedderPolicyStatus `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `value` | [CrossOriginEmbedderPolicyValue](#crossoriginembedderpolicyvalue) |  |
| `reportOnlyValue` | [CrossOriginEmbedderPolicyValue](#crossoriginembedderpolicyvalue) |  |
| `reportingEndpoint`<br/>_optional_ | `string` |  |
| `reportOnlyReportingEndpoint`<br/>_optional_ | `string` |  |


### <a name="contentsecuritypolicysource"></a>ContentSecurityPolicySource `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"HTTP"`, `"Meta"`

### <a name="contentsecuritypolicystatus"></a>ContentSecurityPolicyStatus `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `effectiveDirectives` | `string` |  |
| `isEnforced` | `boolean` |  |
| `source` | [ContentSecurityPolicySource](#contentsecuritypolicysource) |  |


### <a name="securityisolationstatus"></a>SecurityIsolationStatus `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `coop`<br/>_optional_ | [CrossOriginOpenerPolicyStatus](#crossoriginopenerpolicystatus) |  |
| `coep`<br/>_optional_ | [CrossOriginEmbedderPolicyStatus](#crossoriginembedderpolicystatus) |  |
| `csp`<br/>_optional_ | array of [ContentSecurityPolicyStatus](#contentsecuritypolicystatus) |  |


### <a name="reportstatus"></a>ReportStatus `🧪 experimental`

The status of a Reporting API report.

* **Type**: `string`
* **Allowed values**: `"Queued"`, `"Pending"`, `"MarkedForRemoval"`, `"Success"`

### <a name="reportid"></a>ReportId `🧪 experimental`

* **Type**: `string`

### <a name="reportingapireport"></a>ReportingApiReport `🧪 experimental`

An object representing a report generated by the Reporting API.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [ReportId](#reportid) |  |
| `initiatorUrl` | `string` | The URL of the document that triggered the report. |
| `destination` | `string` | The name of the endpoint group that should be used to deliver the report. |
| `type` | `string` | The type of the report (specifies the set of data that is contained in the report body). |
| `timestamp` | [TimeSinceEpoch](#timesinceepoch) | When the report was generated. |
| `depth` | `integer` | How many uploads deep the related request was. |
| `completedAttempts` | `integer` | The number of delivery attempts made so far, not including an active attempt. |
| `body` | `object` |  |
| `status` | [ReportStatus](#reportstatus) |  |


### <a name="reportingapiendpoint"></a>ReportingApiEndpoint `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | The URL of the endpoint to which reports may be delivered. |
| `groupName` | `string` | Name of the endpoint group. |


### <a name="deviceboundsessionkey"></a>DeviceBoundSessionKey `🧪 experimental`

Unique identifier for a device bound session.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `site` | `string` | The site the session is set up for. |
| `id` | `string` | The id of the session. |


### <a name="deviceboundsessionwithusage"></a>DeviceBoundSessionWithUsage `🧪 experimental`

How a device bound session was used during a request.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `sessionKey` | [DeviceBoundSessionKey](#deviceboundsessionkey) | The key for the session. |
| `usage` | `string` | How the session was used (or not used).<br/>Allowed values: `"NotInScope"`, `"InScopeRefreshNotYetNeeded"`, `"InScopeRefreshNotAllowed"`, `"ProactiveRefreshNotPossible"`, `"ProactiveRefreshAttempted"`, `"Deferred"` |


### <a name="deviceboundsessioncookiecraving"></a>DeviceBoundSessionCookieCraving `🧪 experimental`

A device bound session's cookie craving.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | The name of the craving. |
| `domain` | `string` | The domain of the craving. |
| `path` | `string` | The path of the craving. |
| `secure` | `boolean` | The `Secure` attribute of the craving attributes. |
| `httpOnly` | `boolean` | The `HttpOnly` attribute of the craving attributes. |
| `sameSite`<br/>_optional_ | [CookieSameSite](#cookiesamesite) | The `SameSite` attribute of the craving attributes. |


### <a name="deviceboundsessionurlrule"></a>DeviceBoundSessionUrlRule `🧪 experimental`

A device bound session's inclusion URL rule.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `ruleType` | `string` | See comments on `net::device_bound_sessions::SessionInclusionRules::UrlRule::rule_type`.<br/>Allowed values: `"Exclude"`, `"Include"` |
| `hostPattern` | `string` | See comments on `net::device_bound_sessions::SessionInclusionRules::UrlRule::host_pattern`. |
| `pathPrefix` | `string` | See comments on `net::device_bound_sessions::SessionInclusionRules::UrlRule::path_prefix`. |


### <a name="deviceboundsessioninclusionrules"></a>DeviceBoundSessionInclusionRules `🧪 experimental`

A device bound session's inclusion rules.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | See comments on `net::device_bound_sessions::SessionInclusionRules::origin_`. |
| `includeSite` | `boolean` | Whether the whole site is included. See comments on<br/>`net::device_bound_sessions::SessionInclusionRules::include_site_` for more<br/>details; this boolean is true if that value is populated. |
| `urlRules` | array of [DeviceBoundSessionUrlRule](#deviceboundsessionurlrule) | See comments on `net::device_bound_sessions::SessionInclusionRules::url_rules_`. |


### <a name="deviceboundsession"></a>DeviceBoundSession `🧪 experimental`

A device bound session.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | [DeviceBoundSessionKey](#deviceboundsessionkey) | The site and session ID of the session. |
| `refreshUrl` | `string` | See comments on `net::device_bound_sessions::Session::refresh_url_`. |
| `inclusionRules` | [DeviceBoundSessionInclusionRules](#deviceboundsessioninclusionrules) | See comments on `net::device_bound_sessions::Session::inclusion_rules_`. |
| `cookieCravings` | array of [DeviceBoundSessionCookieCraving](#deviceboundsessioncookiecraving) | See comments on `net::device_bound_sessions::Session::cookie_cravings_`. |
| `expiryDate` | [TimeSinceEpoch](#timesinceepoch) | See comments on `net::device_bound_sessions::Session::expiry_date_`. |
| `cachedChallenge`<br/>_optional_ | `string` | See comments on `net::device_bound_sessions::Session::cached_challenge__`. |
| `allowedRefreshInitiators` | array of `string` | See comments on `net::device_bound_sessions::Session::allowed_refresh_initiators_`. |


### <a name="deviceboundsessioneventid"></a>DeviceBoundSessionEventId `🧪 experimental`

A unique identifier for a device bound session event.

* **Type**: `string`

### <a name="deviceboundsessionfetchresult"></a>DeviceBoundSessionFetchResult `🧪 experimental`

A fetch result for a device bound session creation or refresh.
LINT.IfChange(DeviceBoundSessionFetchResult)

* **Type**: `string`
* **Allowed values**: `"Success"`, `"SigningKeyGenerationError"`, `"AttestationKeyGenerationError"`, `"SigningError"`, `"TransientSigningError"`, `"ServerRequestedTermination"`, `"InvalidSessionId"`, `"InvalidChallenge"`, `"TooManyChallenges"`, `"InvalidFetcherUrl"`, `"InvalidRefreshUrl"`, `"TransientHttpError"`, `"ScopeOriginSameSiteMismatch"`, `"RefreshUrlSameSiteMismatch"`, `"MismatchedSessionId"`, `"MissingScope"`, `"NoCredentials"`, `"SubdomainRegistrationWellKnownUnavailable"`, `"SubdomainRegistrationUnauthorized"`, `"SubdomainRegistrationWellKnownMalformed"`, `"SessionProviderWellKnownUnavailable"`, `"RelyingPartyWellKnownUnavailable"`, `"FederatedKeyThumbprintMismatch"`, `"InvalidFederatedSessionUrl"`, `"InvalidFederatedKey"`, `"TooManyRelyingOriginLabels"`, `"BoundCookieSetForbidden"`, `"NetError"`, `"ProxyError"`, `"EmptySessionConfig"`, `"InvalidCredentialsConfig"`, `"InvalidCredentialsType"`, `"InvalidCredentialsEmptyName"`, `"InvalidCredentialsCookie"`, `"PersistentHttpError"`, `"RegistrationAttemptedChallenge"`, `"InvalidScopeOrigin"`, `"ScopeOriginContainsPath"`, `"RefreshInitiatorNotString"`, `"RefreshInitiatorInvalidHostPattern"`, `"InvalidScopeSpecification"`, `"MissingScopeSpecificationType"`, `"EmptyScopeSpecificationDomain"`, `"EmptyScopeSpecificationPath"`, `"InvalidScopeSpecificationType"`, `"InvalidScopeIncludeSite"`, `"MissingScopeIncludeSite"`, `"FederatedNotAuthorizedByProvider"`, `"FederatedNotAuthorizedByRelyingParty"`, `"SessionProviderWellKnownMalformed"`, `"SessionProviderWellKnownHasProviderOrigin"`, `"RelyingPartyWellKnownMalformed"`, `"RelyingPartyWellKnownHasRelyingOrigins"`, `"InvalidFederatedSessionProviderSessionMissing"`, `"InvalidFederatedSessionWrongProviderOrigin"`, `"InvalidCredentialsCookieCreationTime"`, `"InvalidCredentialsCookieName"`, `"InvalidCredentialsCookieParsing"`, `"InvalidCredentialsCookieUnpermittedAttribute"`, `"InvalidCredentialsCookieInvalidDomain"`, `"InvalidCredentialsCookiePrefix"`, `"InvalidScopeRulePath"`, `"InvalidScopeRuleHostPattern"`, `"ScopeRuleOriginScopedHostPatternMismatch"`, `"ScopeRuleSiteScopedHostPatternMismatch"`, `"SigningQuotaExceeded"`, `"InvalidConfigJson"`, `"InvalidFederatedSessionProviderFailedToRestoreKey"`, `"FailedToUnwrapKey"`, `"SessionDeletedDuringRefresh"`, `"CrossOriginRegistrationSiteNotIncluded"`, `"InvalidPreProvisionedKeyInitiatorMissing"`, `"PreProvisionedKeyAccessNotGranted"`, `"PreProvisionedKeyNotFound"`

### <a name="deviceboundsessionfailedrequest"></a>DeviceBoundSessionFailedRequest `🧪 experimental`

Details about a failed device bound session network request.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `requestUrl` | `string` | The failed request URL. |
| `netError`<br/>_optional_ | `string` | The net error of the response if it was not OK. |
| `responseError`<br/>_optional_ | `integer` | The response code if the net error was OK and the response code was not<br/>200. |
| `responseErrorBody`<br/>_optional_ | `string` | The body of the response if the net error was OK, the response code was<br/>not 200, and the response body was not empty. |


### <a name="creationeventdetails"></a>CreationEventDetails `🧪 experimental`

Session event details specific to creation.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `fetchResult` | [DeviceBoundSessionFetchResult](#deviceboundsessionfetchresult) | The result of the fetch attempt. |
| `newSession`<br/>_optional_ | [DeviceBoundSession](#deviceboundsession) | The session if there was a newly created session. This is populated for<br/>all successful creation events. |
| `failedRequest`<br/>_optional_ | [DeviceBoundSessionFailedRequest](#deviceboundsessionfailedrequest) | Details about a failed device bound session network request if there was<br/>one. |


### <a name="refresheventdetails"></a>RefreshEventDetails `🧪 experimental`

Session event details specific to refresh.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `refreshResult` | `string` | The result of a refresh.<br/>Allowed values: `"Refreshed"`, `"InitializedService"`, `"Unreachable"`, `"ServerError"`, `"RefreshQuotaExceeded"`, `"FatalError"`, `"SigningQuotaExceeded"`, `"RefreshedAsWaiter"`, `"TransientSigningError"` |
| `fetchResult`<br/>_optional_ | [DeviceBoundSessionFetchResult](#deviceboundsessionfetchresult) | If there was a fetch attempt, the result of that. |
| `newSession`<br/>_optional_ | [DeviceBoundSession](#deviceboundsession) | The session display if there was a newly created session. This is populated<br/>for any refresh event that modifies the session config. |
| `wasFullyProactiveRefresh` | `boolean` | See comments on `net::device_bound_sessions::RefreshEventResult::was_fully_proactive_refresh`. |
| `failedRequest`<br/>_optional_ | [DeviceBoundSessionFailedRequest](#deviceboundsessionfailedrequest) | Details about a failed device bound session network request if there was<br/>one. |


### <a name="terminationeventdetails"></a>TerminationEventDetails `🧪 experimental`

Session event details specific to termination.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `deletionReason` | `string` | The reason for a session being deleted.<br/>Allowed values: `"Expired"`, `"FailedToRestoreKey"`, `"FailedToUnwrapKey"`, `"StoragePartitionCleared"`, `"ClearBrowsingData"`, `"ServerRequested"`, `"InvalidSessionParams"`, `"RefreshFatalError"`, `"DevTools"` |


### <a name="challengeeventdetails"></a>ChallengeEventDetails `🧪 experimental`

Session event details specific to challenges.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `challengeResult` | `string` | The result of a challenge.<br/>Allowed values: `"Success"`, `"NoSessionId"`, `"NoSessionMatch"`, `"CantSetBoundCookie"` |
| `challenge` | `string` | The challenge set. |


### <a name="loadnetworkresourcepageresult"></a>LoadNetworkResourcePageResult `🧪 experimental`

An object providing the result of a network resource load.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `success` | `boolean` |  |
| `netError`<br/>_optional_ | `number` | Optional values used for error reporting. |
| `netErrorName`<br/>_optional_ | `string` |  |
| `httpStatusCode`<br/>_optional_ | `number` |  |
| `stream`<br/>_optional_ | [IO.StreamHandle](IO.md#streamhandle) | If successful, one of the following two fields holds the result. |
| `headers`<br/>_optional_ | [Headers](#headers) | Response headers. |


### <a name="loadnetworkresourceoptions"></a>LoadNetworkResourceOptions `🧪 experimental`

An options object that may be extended later to better support CORS,
CORB and streaming.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `disableCache` | `boolean` |  |
| `includeCredentials` | `boolean` |  |


---

<a name="commands"></a>
## Commands

### <a name="setacceptedencodings"></a>setAcceptedEncodings `🧪 experimental`

Sets a list of content encodings that will be accepted. Empty list means no encoding is accepted.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `encodings` | array of [ContentEncoding](#contentencoding) | List of accepted content encodings. |

* **Returns**: None


### <a name="clearacceptedencodingsoverride"></a>clearAcceptedEncodingsOverride `🧪 experimental`

Clears accepted encodings set by setAcceptedEncodings

* **Parameters**: None

* **Returns**: None


### <a name="canclearbrowsercache"></a>canClearBrowserCache `⚠️ deprecated`

Tells whether clearing browser cache is supported.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | `boolean` | True if browser cache can be cleared. |


### <a name="canclearbrowsercookies"></a>canClearBrowserCookies `⚠️ deprecated`

Tells whether clearing browser cookies is supported.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | `boolean` | True if browser cookies can be cleared. |


### <a name="canemulatenetworkconditions"></a>canEmulateNetworkConditions `⚠️ deprecated`

Tells whether emulation of network conditions is supported.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | `boolean` | True if emulation of network conditions is supported. |


### <a name="clearbrowsercache"></a>clearBrowserCache

Clears browser cache.

* **Parameters**: None

* **Returns**: None


### <a name="clearbrowsercookies"></a>clearBrowserCookies

Clears browser cookies.

* **Parameters**: None

* **Returns**: None


### <a name="continueinterceptedrequest"></a>continueInterceptedRequest `🧪 experimental` `⚠️ deprecated`

Response to Network.requestIntercepted which either modifies the request to continue with any
modifications, or blocks it, or completes it with the provided response bytes. If a network
fetch occurs as a result which encounters a redirect an additional Network.requestIntercepted
event will be sent with the same InterceptionId.
Deprecated, use Fetch.continueRequest, Fetch.fulfillRequest and Fetch.failRequest instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `interceptionId` | [InterceptionId](#interceptionid) |  |
| `errorReason`<br/>_optional_ | [ErrorReason](#errorreason) | If set this causes the request to fail with the given reason. Passing `Aborted` for requests<br/>marked with `isNavigationRequest` also cancels the navigation. Must not be set in response<br/>to an authChallenge. |
| `rawResponse`<br/>_optional_ | `string` | If set the requests completes using with the provided base64 encoded raw response, including<br/>HTTP status line and headers etc... Must not be set in response to an authChallenge. (Encoded as a base64 string when passed over JSON) |
| `url`<br/>_optional_ | `string` | If set the request url will be modified in a way that's not observable by page. Must not be<br/>set in response to an authChallenge. |
| `method`<br/>_optional_ | `string` | If set this allows the request method to be overridden. Must not be set in response to an<br/>authChallenge. |
| `postData`<br/>_optional_ | `string` | If set this allows postData to be set. Must not be set in response to an authChallenge. |
| `headers`<br/>_optional_ | [Headers](#headers) | If set this allows the request headers to be changed. Must not be set in response to an<br/>authChallenge. |
| `authChallengeResponse`<br/>_optional_ | [AuthChallengeResponse](#authchallengeresponse) | Response to a requestIntercepted with an authChallenge. Must not be set otherwise. |

* **Returns**: None


### <a name="deletecookies"></a>deleteCookies

Deletes browser cookies with matching name and url or domain/path/partitionKey pair.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Name of the cookies to remove. |
| `url`<br/>_optional_ | `string` | If specified, deletes all the cookies with the given name where domain and path match<br/>provided URL. |
| `domain`<br/>_optional_ | `string` | If specified, deletes only cookies with the exact domain. |
| `path`<br/>_optional_ | `string` | If specified, deletes only cookies with the exact path. |
| `partitionKey`<br/>_optional_ | [CookiePartitionKey](#cookiepartitionkey) | `🧪 experimental` If specified, deletes only cookies with the the given name and partitionKey where<br/>all partition key attributes match the cookie partition key attribute. |

* **Returns**: None


### <a name="disable"></a>disable

Disables network tracking, prevents network events from being sent to the client.

* **Parameters**: None

* **Returns**: None


### <a name="emulatenetworkconditions"></a>emulateNetworkConditions `⚠️ deprecated`

Activates emulation of network conditions. This command is deprecated in favor of the emulateNetworkConditionsByRule
and overrideNetworkState commands, which can be used together to the same effect.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `offline` | `boolean` | True to emulate internet disconnection. |
| `latency` | `number` | Minimum latency from request sent to response headers received (ms). |
| `downloadThroughput` | `number` | Maximal aggregated download throughput (bytes/sec). -1 disables download throttling. |
| `uploadThroughput` | `number` | Maximal aggregated upload throughput (bytes/sec).  -1 disables upload throttling. |
| `connectionType`<br/>_optional_ | [ConnectionType](#connectiontype) | Connection type if known. |
| `packetLoss`<br/>_optional_ | `number` | `🧪 experimental` WebRTC packet loss (percent, 0-100). 0 disables packet loss emulation, 100 drops all the packets. |
| `packetQueueLength`<br/>_optional_ | `integer` | `🧪 experimental` WebRTC packet queue length (packet). 0 removes any queue length limitations. |
| `packetReordering`<br/>_optional_ | `boolean` | `🧪 experimental` WebRTC packetReordering feature. |

* **Returns**: None


### <a name="emulatenetworkconditionsbyrule"></a>emulateNetworkConditionsByRule `🧪 experimental`

Activates emulation of network conditions for individual requests using URL match patterns. Unlike the deprecated
Network.emulateNetworkConditions this method does not affect `navigator` state. Use Network.overrideNetworkState to
explicitly modify `navigator` behavior.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `offline`<br/>_optional_ | `boolean` | `⚠️ deprecated` True to emulate internet disconnection. Deprecated, use the offline property in matchedNetworkConditions<br/>or emulateOfflineServiceWorker instead. |
| `emulateOfflineServiceWorker`<br/>_optional_ | `boolean` | True to emulate offline service worker. |
| `matchedNetworkConditions` | array of [NetworkConditions](#networkconditions) | Configure conditions for matching requests. If multiple entries match a request, the first entry wins.  Global<br/>conditions can be configured by leaving the urlPattern for the conditions empty. These global conditions are<br/>also applied for throttling of p2p connections. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `ruleIds` | array of `string` | An id for each entry in matchedNetworkConditions. The id will be included in the requestWillBeSentExtraInfo for<br/>requests affected by a rule. |


### <a name="overridenetworkstate"></a>overrideNetworkState `🧪 experimental`

Override the state of navigator.onLine and navigator.connection.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `offline` | `boolean` | True to emulate internet disconnection. |
| `latency` | `number` | Minimum latency from request sent to response headers received (ms). |
| `downloadThroughput` | `number` | Maximal aggregated download throughput (bytes/sec). -1 disables download throttling. |
| `uploadThroughput` | `number` | Maximal aggregated upload throughput (bytes/sec).  -1 disables upload throttling. |
| `connectionType`<br/>_optional_ | [ConnectionType](#connectiontype) | Connection type if known. |

* **Returns**: None


### <a name="enable"></a>enable

Enables network tracking, network events will now be delivered to the client.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `maxTotalBufferSize`<br/>_optional_ | `integer` | `🧪 experimental` Buffer size in bytes to use when preserving network payloads (XHRs, etc).<br/>This is the maximum number of bytes that will be collected by this<br/>DevTools session. |
| `maxResourceBufferSize`<br/>_optional_ | `integer` | `🧪 experimental` Per-resource buffer size in bytes to use when preserving network payloads (XHRs, etc). |
| `maxPostDataSize`<br/>_optional_ | `integer` | Longest post body size (in bytes) that would be included in requestWillBeSent notification |
| `reportDirectSocketTraffic`<br/>_optional_ | `boolean` | `🧪 experimental` Whether DirectSocket chunk send/receive events should be reported. |
| `enableDurableMessages`<br/>_optional_ | `boolean` | `🧪 experimental` Enable storing response bodies outside of renderer, so that these survive<br/>a cross-process navigation. Requires maxTotalBufferSize to be set.<br/>Currently defaults to false. This field is being deprecated in favor of the dedicated<br/>configureDurableMessages command, due to the possibility of deadlocks when awaiting<br/>Network.enable before issuing Runtime.runIfWaitingForDebugger. |

* **Returns**: None


### <a name="configuredurablemessages"></a>configureDurableMessages `🧪 experimental`

Configures storing response bodies outside of renderer, so that these survive
a cross-process navigation.
If maxTotalBufferSize is not set, durable messages are disabled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `maxTotalBufferSize`<br/>_optional_ | `integer` | Buffer size in bytes to use when preserving network payloads (XHRs, etc). |
| `maxResourceBufferSize`<br/>_optional_ | `integer` | Per-resource buffer size in bytes to use when preserving network payloads (XHRs, etc). |

* **Returns**: None


### <a name="getallcookies"></a>getAllCookies `⚠️ deprecated`

Returns all browser cookies. Depending on the backend support, will return detailed cookie
information in the `cookies` field.
Deprecated. Use Storage.getCookies instead.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `cookies` | array of [Cookie](#cookie) | Array of cookie objects. |


### <a name="getcertificate"></a>getCertificate `🧪 experimental`

Returns the DER-encoded certificate.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Origin to get certificate for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `tableNames` | array of `string` |  |


### <a name="getcookies"></a>getCookies

Returns all browser cookies for the current URL. Depending on the backend support, will return
detailed cookie information in the `cookies` field.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `urls`<br/>_optional_ | array of `string` | The list of URLs for which applicable cookies will be fetched.<br/>If not specified, it's assumed to be set to the list containing<br/>the URLs of the page and all of its subframes. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `cookies` | array of [Cookie](#cookie) | Array of cookie objects. |


### <a name="getresponsebody"></a>getResponseBody

Returns content served for the given request.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Identifier of the network request to get content for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `body` | `string` | Response body. |
| `base64Encoded` | `boolean` | True, if content was sent as base64. |


### <a name="getrequestpostdata"></a>getRequestPostData

Returns post data sent with the request. Returns an error when no data was sent with the request.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Identifier of the network request to get content for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `postData` | `string` | Request body string, omitting files from multipart requests |
| `base64Encoded` | `boolean` | True, if content was sent as base64. |


### <a name="getresponsebodyforinterception"></a>getResponseBodyForInterception `🧪 experimental`

Returns content served for the given currently intercepted request.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `interceptionId` | [InterceptionId](#interceptionid) | Identifier for the intercepted request to get body for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `body` | `string` | Response body. |
| `base64Encoded` | `boolean` | True, if content was sent as base64. |


### <a name="takeresponsebodyforinterceptionasstream"></a>takeResponseBodyForInterceptionAsStream `🧪 experimental`

Returns a handle to the stream representing the response body. Note that after this command,
the intercepted request can't be continued as is -- you either need to cancel it or to provide
the response body. The stream only supports sequential read, IO.read will fail if the position
is specified.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `interceptionId` | [InterceptionId](#interceptionid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `stream` | [IO.StreamHandle](IO.md#streamhandle) |  |


### <a name="replayxhr"></a>replayXHR `🧪 experimental`

This method sends a new XMLHttpRequest which is identical to the original one. The following
parameters should be identical: method, url, async, request body, extra headers, withCredentials
attribute, user, password.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Identifier of XHR to replay. |

* **Returns**: None


### <a name="searchinresponsebody"></a>searchInResponseBody `🧪 experimental`

Searches for given string in response content.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Identifier of the network response to search. |
| `query` | `string` | String to search for. |
| `caseSensitive`<br/>_optional_ | `boolean` | If true, search is case sensitive. |
| `isRegex`<br/>_optional_ | `boolean` | If true, treats string parameter as regex. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | array of [Debugger.SearchMatch](Debugger.md#searchmatch) | List of search matches. |


### <a name="setblockedurls"></a>setBlockedURLs `🧪 experimental`

Blocks URLs from loading.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `urlPatterns`<br/>_optional_ | array of [BlockPattern](#blockpattern) | Patterns to match in the order in which they are given. These patterns<br/>also take precedence over any wildcard patterns defined in `urls`. |
| `urls`<br/>_optional_ | array of `string` | `⚠️ deprecated` URL patterns to block. Wildcards ('*') are allowed. |

* **Returns**: None


### <a name="setbypassserviceworker"></a>setBypassServiceWorker

Toggles ignoring of service worker for each request.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `bypass` | `boolean` | Bypass service worker and load from network. |

* **Returns**: None


### <a name="setcachedisabled"></a>setCacheDisabled

Toggles ignoring cache for each request. If `true`, cache will not be used.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `cacheDisabled` | `boolean` | Cache disabled state. |

* **Returns**: None


### <a name="setcookie"></a>setCookie

Sets a cookie with the given cookie data; may overwrite equivalent cookies if they exist.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Cookie name. |
| `value` | `string` | Cookie value. |
| `url`<br/>_optional_ | `string` | The request-URI to associate with the setting of the cookie. This value can affect the<br/>default domain, path, source port, and source scheme values of the created cookie. |
| `domain`<br/>_optional_ | `string` | Cookie domain. |
| `path`<br/>_optional_ | `string` | Cookie path. |
| `secure`<br/>_optional_ | `boolean` | True if cookie is secure. |
| `httpOnly`<br/>_optional_ | `boolean` | True if cookie is http-only. |
| `sameSite`<br/>_optional_ | [CookieSameSite](#cookiesamesite) | Cookie SameSite type. |
| `expires`<br/>_optional_ | [TimeSinceEpoch](#timesinceepoch) | Cookie expiration date, session cookie if not set |
| `priority`<br/>_optional_ | [CookiePriority](#cookiepriority) | `🧪 experimental` Cookie Priority type. |
| `sourceScheme`<br/>_optional_ | [CookieSourceScheme](#cookiesourcescheme) | `🧪 experimental` Cookie source scheme type. |
| `sourcePort`<br/>_optional_ | `integer` | `🧪 experimental` Cookie source port. Valid values are {-1, [1, 65535]}, -1 indicates an unspecified port.<br/>An unspecified port value allows protocol clients to emulate legacy cookie scope for the port.<br/>This is a temporary ability and it will be removed in the future. |
| `partitionKey`<br/>_optional_ | [CookiePartitionKey](#cookiepartitionkey) | `🧪 experimental` Cookie partition key. If not set, the cookie will be set as not partitioned. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `success` | `boolean` | `⚠️ deprecated` Always set to true. If an error occurs, the response indicates protocol error. |


### <a name="setcookies"></a>setCookies

Sets given cookies.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `cookies` | array of [CookieParam](#cookieparam) | Cookies to be set. |

* **Returns**: None


### <a name="setextrahttpheaders"></a>setExtraHTTPHeaders

Specifies whether to always send extra HTTP headers with the requests from this page.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `headers` | [Headers](#headers) | Map with extra HTTP headers. |

* **Returns**: None


### <a name="setattachdebugstack"></a>setAttachDebugStack `🧪 experimental`

Specifies whether to attach a page script stack id in requests

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | Whether to attach a page script stack for debugging purpose. |

* **Returns**: None


### <a name="setrequestinterception"></a>setRequestInterception `🧪 experimental` `⚠️ deprecated`

Sets the requests to intercept that match the provided patterns and optionally resource types.
Deprecated, please use Fetch.enable instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `patterns` | array of [RequestPattern](#requestpattern) | Requests matching any of these patterns will be forwarded and wait for the corresponding<br/>continueInterceptedRequest call. |

* **Returns**: None


### <a name="setuseragentoverride"></a>setUserAgentOverride

Allows overriding user agent with the given string.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `userAgent` | `string` | User agent to use. |
| `acceptLanguage`<br/>_optional_ | `string` | Browser language to emulate. |
| `platform`<br/>_optional_ | `string` | The platform navigator.platform should return. |
| `userAgentMetadata`<br/>_optional_ | [Emulation.UserAgentMetadata](Emulation.md#useragentmetadata) | `🧪 experimental` To be sent in Sec-CH-UA-* headers and returned in navigator.userAgentData |

* **Returns**: None


### <a name="streamresourcecontent"></a>streamResourceContent `🧪 experimental`

Enables streaming of the response for the given requestId.
If enabled, the dataReceived event contains the data that was received during streaming.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Identifier of the request to stream. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `bufferedData` | `string` | Data that has been buffered until streaming is enabled. (Encoded as a base64 string when passed over JSON) |


### <a name="getsecurityisolationstatus"></a>getSecurityIsolationStatus `🧪 experimental`

Returns information about the COEP/COOP isolation status.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | If no frameId is provided, the status of the target is provided. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `status` | [SecurityIsolationStatus](#securityisolationstatus) |  |


### <a name="enablereportingapi"></a>enableReportingApi `🧪 experimental`

Enables tracking for the Reporting API, events generated by the Reporting API will now be delivered to the client.
Enabling triggers 'reportingApiReportAdded' for all existing reports.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enable` | `boolean` | Whether to enable or disable events for the Reporting API |

* **Returns**: None


### <a name="enabledeviceboundsessions"></a>enableDeviceBoundSessions `🧪 experimental`

Sets up tracking device bound sessions and fetching of initial set of sessions.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enable` | `boolean` | Whether to enable or disable events. |

* **Returns**: None


### <a name="deletedeviceboundsession"></a>deleteDeviceBoundSession `🧪 experimental`

Deletes a device bound session.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | [DeviceBoundSessionKey](#deviceboundsessionkey) |  |

* **Returns**: None


### <a name="fetchschemefulsite"></a>fetchSchemefulSite `🧪 experimental`

Fetches the schemeful site for a specific origin.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | The URL origin. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `schemefulSite` | `string` | The corresponding schemeful site. |


### <a name="loadnetworkresource"></a>loadNetworkResource `🧪 experimental`

Fetches the resource and returns the content.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | Frame id to get the resource for. Mandatory for frame targets, and<br/>should be omitted for worker targets. |
| `url` | `string` | URL of the resource to get content for. |
| `options` | [LoadNetworkResourceOptions](#loadnetworkresourceoptions) | Options for the request. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `resource` | [LoadNetworkResourcePageResult](#loadnetworkresourcepageresult) |  |


### <a name="setcookiecontrols"></a>setCookieControls `🧪 experimental`

Sets Controls for third-party cookie access
Page reload is required before the new cookie behavior will be observed

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enableThirdPartyCookieRestriction` | `boolean` | Whether 3pc restriction is enabled. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="datareceived"></a>dataReceived

Fired when data chunk was received over the network.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `dataLength` | `integer` | Data chunk length. |
| `encodedDataLength` | `integer` | Actual bytes received (might be less than dataLength for compressed encodings). |
| `data`<br/>_optional_ | `string` | `🧪 experimental` Data that was received. (Encoded as a base64 string when passed over JSON) |


### <a name="eventsourcemessagereceived"></a>eventSourceMessageReceived

Fired when EventSource message is received.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `eventName` | `string` | Message type. |
| `eventId` | `string` | Message identifier. |
| `data` | `string` | Message content. |


### <a name="loadingfailed"></a>loadingFailed

Fired when HTTP request has failed to load.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `type` | [ResourceType](#resourcetype) | Resource type. |
| `errorText` | `string` | Error message. List of network errors: https://cs.chromium.org/chromium/src/net/base/net_error_list.h |
| `canceled`<br/>_optional_ | `boolean` | True if loading was canceled. |
| `blockedReason`<br/>_optional_ | [BlockedReason](#blockedreason) | The reason why loading was blocked, if any. |
| `corsErrorStatus`<br/>_optional_ | [CorsErrorStatus](#corserrorstatus) | The reason why loading was blocked by CORS, if any. |


### <a name="loadingfinished"></a>loadingFinished

Fired when HTTP request has finished loading.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `encodedDataLength` | `number` | Total number of bytes received for this request. |


### <a name="requestintercepted"></a>requestIntercepted `🧪 experimental` `⚠️ deprecated`

Details of an intercepted HTTP request, which must be either allowed, blocked, modified or
mocked.
Deprecated, use Fetch.requestPaused instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `interceptionId` | [InterceptionId](#interceptionid) | Each request the page makes will have a unique id, however if any redirects are encountered<br/>while processing that fetch, they will be reported with the same id as the original fetch.<br/>Likewise if HTTP authentication is needed then the same fetch id will be used. |
| `request` | [Request](#request) |  |
| `frameId` | [Page.FrameId](Page.md#frameid) | The id of the frame that initiated the request. |
| `resourceType` | [ResourceType](#resourcetype) | How the requested resource will be used. |
| `isNavigationRequest` | `boolean` | Whether this is a navigation request, which can abort the navigation completely. |
| `isDownload`<br/>_optional_ | `boolean` | Set if the request is a navigation that will result in a download.<br/>Only present after response is received from the server (i.e. HeadersReceived stage). |
| `redirectUrl`<br/>_optional_ | `string` | Redirect location, only sent if a redirect was intercepted. |
| `authChallenge`<br/>_optional_ | [AuthChallenge](#authchallenge) | Details of the Authorization Challenge encountered. If this is set then<br/>continueInterceptedRequest must contain an authChallengeResponse. |
| `responseErrorReason`<br/>_optional_ | [ErrorReason](#errorreason) | Response error if intercepted at response stage or if redirect occurred while intercepting<br/>request. |
| `responseStatusCode`<br/>_optional_ | `integer` | Response code if intercepted at response stage or if redirect occurred while intercepting<br/>request or auth retry occurred. |
| `responseHeaders`<br/>_optional_ | [Headers](#headers) | Response headers if intercepted at the response stage or if redirect occurred while<br/>intercepting request or auth retry occurred. |
| `requestId`<br/>_optional_ | [RequestId](#requestid) | If the intercepted request had a corresponding requestWillBeSent event fired for it, then<br/>this requestId will be the same as the requestId present in the requestWillBeSent event. |


### <a name="requestservedfromcache"></a>requestServedFromCache

Fired if request ended up loading from cache.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |


### <a name="requestwillbesent"></a>requestWillBeSent

Fired when page is about to send HTTP request.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `loaderId` | [LoaderId](#loaderid) | Loader identifier. Empty string if the request is fetched from worker. |
| `documentURL` | `string` | URL of the document this request is loaded for. |
| `request` | [Request](#request) | Request data. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `wallTime` | [TimeSinceEpoch](#timesinceepoch) | Timestamp. |
| `initiator` | [Initiator](#initiator) | Request initiator. |
| `redirectHasExtraInfo` | `boolean` | `🧪 experimental` In the case that redirectResponse is populated, this flag indicates whether<br/>requestWillBeSentExtraInfo and responseReceivedExtraInfo events will be or were emitted<br/>for the request which was just redirected. |
| `redirectResponse`<br/>_optional_ | [Response](#response) | Redirect response data. |
| `type`<br/>_optional_ | [ResourceType](#resourcetype) | Type of this resource. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | Frame identifier. |
| `hasUserGesture`<br/>_optional_ | `boolean` | Whether the request is initiated by a user gesture. Defaults to false. |
| `renderBlockingBehavior`<br/>_optional_ | [RenderBlockingBehavior](#renderblockingbehavior) | `🧪 experimental` The render-blocking behavior of the request. |


### <a name="resourcechangedpriority"></a>resourceChangedPriority `🧪 experimental`

Fired when resource loading priority is changed

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `newPriority` | [ResourcePriority](#resourcepriority) | New priority |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |


### <a name="signedexchangereceived"></a>signedExchangeReceived `🧪 experimental`

Fired when a signed exchange was received over the network

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `info` | [SignedExchangeInfo](#signedexchangeinfo) | Information about the signed exchange response. |


### <a name="responsereceived"></a>responseReceived

Fired when HTTP response is available.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `loaderId` | [LoaderId](#loaderid) | Loader identifier. Empty string if the request is fetched from worker. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `type` | [ResourceType](#resourcetype) | Resource type. |
| `response` | [Response](#response) | Response data. |
| `hasExtraInfo` | `boolean` | `🧪 experimental` Indicates whether requestWillBeSentExtraInfo and responseReceivedExtraInfo events will be<br/>or were emitted for this request. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | Frame identifier. |


### <a name="websocketclosed"></a>webSocketClosed

Fired when WebSocket is closed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |


### <a name="websocketcreated"></a>webSocketCreated

Fired upon WebSocket creation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `url` | `string` | WebSocket request URL. |
| `initiator`<br/>_optional_ | [Initiator](#initiator) | Request initiator. |


### <a name="websocketframeerror"></a>webSocketFrameError

Fired when WebSocket message error occurs.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `errorMessage` | `string` | WebSocket error message. |


### <a name="websocketframereceived"></a>webSocketFrameReceived

Fired when WebSocket message is received.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `response` | [WebSocketFrame](#websocketframe) | WebSocket response data. |


### <a name="websocketframesent"></a>webSocketFrameSent

Fired when WebSocket message is sent.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `response` | [WebSocketFrame](#websocketframe) | WebSocket response data. |


### <a name="websockethandshakeresponsereceived"></a>webSocketHandshakeResponseReceived

Fired when WebSocket handshake response becomes available.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `response` | [WebSocketResponse](#websocketresponse) | WebSocket response data. |


### <a name="websocketwillsendhandshakerequest"></a>webSocketWillSendHandshakeRequest

Fired when WebSocket is about to initiate handshake.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `wallTime` | [TimeSinceEpoch](#timesinceepoch) | UTC Timestamp. |
| `request` | [WebSocketRequest](#websocketrequest) | WebSocket request data. |


### <a name="webtransportcreated"></a>webTransportCreated

Fired upon WebTransport creation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `transportId` | [RequestId](#requestid) | WebTransport identifier. |
| `url` | `string` | WebTransport request URL. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |
| `initiator`<br/>_optional_ | [Initiator](#initiator) | Request initiator. |


### <a name="webtransportconnectionestablished"></a>webTransportConnectionEstablished

Fired when WebTransport handshake is finished.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `transportId` | [RequestId](#requestid) | WebTransport identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |


### <a name="webtransportclosed"></a>webTransportClosed

Fired when WebTransport is disposed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `transportId` | [RequestId](#requestid) | WebTransport identifier. |
| `timestamp` | [MonotonicTime](#monotonictime) | Timestamp. |


### <a name="directtcpsocketcreated"></a>directTCPSocketCreated `🧪 experimental`

Fired upon direct_socket.TCPSocket creation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `remoteAddr` | `string` |  |
| `remotePort` | `integer` | Unsigned int 16. |
| `options` | [DirectTCPSocketOptions](#directtcpsocketoptions) |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |
| `initiator`<br/>_optional_ | [Initiator](#initiator) |  |


### <a name="directtcpsocketopened"></a>directTCPSocketOpened `🧪 experimental`

Fired when direct_socket.TCPSocket connection is opened.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `remoteAddr` | `string` |  |
| `remotePort` | `integer` | Expected to be unsigned integer. |
| `timestamp` | [MonotonicTime](#monotonictime) |  |
| `localAddr`<br/>_optional_ | `string` |  |
| `localPort`<br/>_optional_ | `integer` | Expected to be unsigned integer. |


### <a name="directtcpsocketaborted"></a>directTCPSocketAborted `🧪 experimental`

Fired when direct_socket.TCPSocket is aborted.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `errorMessage` | `string` |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |


### <a name="directtcpsocketclosed"></a>directTCPSocketClosed `🧪 experimental`

Fired when direct_socket.TCPSocket is closed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |


### <a name="directtcpsocketchunksent"></a>directTCPSocketChunkSent `🧪 experimental`

Fired when data is sent to tcp direct socket stream.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `data` | `string` |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |


### <a name="directtcpsocketchunkreceived"></a>directTCPSocketChunkReceived `🧪 experimental`

Fired when data is received from tcp direct socket stream.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `data` | `string` |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |


### <a name="directudpsocketjoinedmulticastgroup"></a>directUDPSocketJoinedMulticastGroup `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `IPAddress` | `string` |  |


### <a name="directudpsocketleftmulticastgroup"></a>directUDPSocketLeftMulticastGroup `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `IPAddress` | `string` |  |


### <a name="directudpsocketcreated"></a>directUDPSocketCreated `🧪 experimental`

Fired upon direct_socket.UDPSocket creation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `options` | [DirectUDPSocketOptions](#directudpsocketoptions) |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |
| `initiator`<br/>_optional_ | [Initiator](#initiator) |  |


### <a name="directudpsocketopened"></a>directUDPSocketOpened `🧪 experimental`

Fired when direct_socket.UDPSocket connection is opened.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `localAddr` | `string` |  |
| `localPort` | `integer` | Expected to be unsigned integer. |
| `timestamp` | [MonotonicTime](#monotonictime) |  |
| `remoteAddr`<br/>_optional_ | `string` |  |
| `remotePort`<br/>_optional_ | `integer` | Expected to be unsigned integer. |


### <a name="directudpsocketaborted"></a>directUDPSocketAborted `🧪 experimental`

Fired when direct_socket.UDPSocket is aborted.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `errorMessage` | `string` |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |


### <a name="directudpsocketclosed"></a>directUDPSocketClosed `🧪 experimental`

Fired when direct_socket.UDPSocket is closed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |


### <a name="directudpsocketchunksent"></a>directUDPSocketChunkSent `🧪 experimental`

Fired when message is sent to udp direct socket stream.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `message` | [DirectUDPMessage](#directudpmessage) |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |


### <a name="directudpsocketchunkreceived"></a>directUDPSocketChunkReceived `🧪 experimental`

Fired when message is received from udp direct socket stream.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `identifier` | [RequestId](#requestid) |  |
| `message` | [DirectUDPMessage](#directudpmessage) |  |
| `timestamp` | [MonotonicTime](#monotonictime) |  |


### <a name="requestwillbesentextrainfo"></a>requestWillBeSentExtraInfo `🧪 experimental`

Fired when additional information about a requestWillBeSent event is available from the
network stack. Not every requestWillBeSent event will have an additional
requestWillBeSentExtraInfo fired for it, and there is no guarantee whether requestWillBeSent
or requestWillBeSentExtraInfo will be fired first for the same request.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. Used to match this information to an existing requestWillBeSent event. |
| `associatedCookies` | array of [AssociatedCookie](#associatedcookie) | A list of cookies potentially associated to the requested URL. This includes both cookies sent with<br/>the request and the ones not sent; the latter are distinguished by having blockedReasons field set. |
| `headers` | [Headers](#headers) | Raw request headers as they will be sent over the wire. |
| `connectTiming` | [ConnectTiming](#connecttiming) | `🧪 experimental` Connection timing information for the request. |
| `deviceBoundSessionUsages`<br/>_optional_ | array of [DeviceBoundSessionWithUsage](#deviceboundsessionwithusage) | How the request site's device bound sessions were used during this request. |
| `clientSecurityState`<br/>_optional_ | [ClientSecurityState](#clientsecuritystate) | The client security state set for the request. |
| `siteHasCookieInOtherPartition`<br/>_optional_ | `boolean` | Whether the site has partitioned cookies stored in a partition different than the current one. |
| `appliedNetworkConditionsId`<br/>_optional_ | `string` | The network conditions id if this request was affected by network conditions configured via<br/>emulateNetworkConditionsByRule. |


### <a name="responsereceivedextrainfo"></a>responseReceivedExtraInfo `🧪 experimental`

Fired when additional information about a responseReceived event is available from the network
stack. Not every responseReceived event will have an additional responseReceivedExtraInfo for
it, and responseReceivedExtraInfo may be fired before or after responseReceived.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. Used to match this information to another responseReceived event. |
| `blockedCookies` | array of [BlockedSetCookieWithReason](#blockedsetcookiewithreason) | A list of cookies which were not stored from the response along with the corresponding<br/>reasons for blocking. The cookies here may not be valid due to syntax errors, which<br/>are represented by the invalid cookie line string instead of a proper cookie. |
| `headers` | [Headers](#headers) | Raw response headers as they were received over the wire.<br/>Duplicate headers in the response are represented as a single key with their values<br/>concatentated using `\n` as the separator.<br/>See also `headersText` that contains verbatim text for HTTP/1.*. |
| `resourceIPAddressSpace` | [IPAddressSpace](#ipaddressspace) | The IP address space of the resource. The address space can only be determined once the transport<br/>established the connection, so we can't send it in `requestWillBeSentExtraInfo`. |
| `statusCode` | `integer` | The status code of the response. This is useful in cases the request failed and no responseReceived<br/>event is triggered, which is the case for, e.g., CORS errors. This is also the correct status code<br/>for cached requests, where the status in responseReceived is a 200 and this will be 304. |
| `headersText`<br/>_optional_ | `string` | Raw response header text as it was received over the wire. The raw text may not always be<br/>available, such as in the case of HTTP/2 or QUIC. |
| `cookiePartitionKey`<br/>_optional_ | [CookiePartitionKey](#cookiepartitionkey) | `🧪 experimental` The cookie partition key that will be used to store partitioned cookies set in this response.<br/>Only sent when partitioned cookies are enabled. |
| `cookiePartitionKeyOpaque`<br/>_optional_ | `boolean` | True if partitioned cookies are enabled, but the partition key is not serializable to string. |
| `exemptedCookies`<br/>_optional_ | array of [ExemptedSetCookieWithReason](#exemptedsetcookiewithreason) | A list of cookies which should have been blocked by 3PCD but are exempted and stored from<br/>the response with the corresponding reason. |


### <a name="responsereceivedearlyhints"></a>responseReceivedEarlyHints `🧪 experimental`

Fired when 103 Early Hints headers is received in addition to the common response.
Not every responseReceived event will have an responseReceivedEarlyHints fired.
Only one responseReceivedEarlyHints may be fired for eached responseReceived event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Request identifier. Used to match this information to another responseReceived event. |
| `headers` | [Headers](#headers) | Raw response headers as they were received over the wire.<br/>Duplicate headers in the response are represented as a single key with their values<br/>concatentated using `\n` as the separator.<br/>See also `headersText` that contains verbatim text for HTTP/1.*. |


### <a name="trusttokenoperationdone"></a>trustTokenOperationDone `🧪 experimental`

Fired exactly once for each Trust Token operation. Depending on
the type of the operation and whether the operation succeeded or
failed, the event is fired before the corresponding request was sent
or after the response was received.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `status` | `string` | Detailed success or error status of the operation.<br/>'AlreadyExists' also signifies a successful operation, as the result<br/>of the operation already exists und thus, the operation was abort<br/>preemptively (e.g. a cache hit).<br/>Allowed values: `"Ok"`, `"InvalidArgument"`, `"MissingIssuerKeys"`, `"FailedPrecondition"`, `"ResourceExhausted"`, `"AlreadyExists"`, `"ResourceLimited"`, `"Unauthorized"`, `"BadResponse"`, `"InternalError"`, `"UnknownError"`, `"FulfilledLocally"`, `"SiteIssuerLimit"` |
| `type` | [TrustTokenOperationType](#trusttokenoperationtype) |  |
| `requestId` | [RequestId](#requestid) |  |
| `topLevelOrigin`<br/>_optional_ | `string` | Top level origin. The context in which the operation was attempted. |
| `issuerOrigin`<br/>_optional_ | `string` | Origin of the issuer in case of a "Issuance" or "Redemption" operation. |
| `issuedTokenCount`<br/>_optional_ | `integer` | The number of obtained Trust Tokens on a successful "Issuance" operation. |


### <a name="policyupdated"></a>policyUpdated `🧪 experimental`

Fired once security policy has been updated.

* **Parameters**: None


### <a name="reportingapireportadded"></a>reportingApiReportAdded `🧪 experimental`

Is sent whenever a new report is added.
And after 'enableReportingApi' for all existing reports.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `report` | [ReportingApiReport](#reportingapireport) |  |


### <a name="reportingapireportupdated"></a>reportingApiReportUpdated `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `report` | [ReportingApiReport](#reportingapireport) |  |


### <a name="reportingapiendpointschangedfororigin"></a>reportingApiEndpointsChangedForOrigin `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` | Origin of the document(s) which configured the endpoints. |
| `endpoints` | array of [ReportingApiEndpoint](#reportingapiendpoint) |  |


### <a name="deviceboundsessionsadded"></a>deviceBoundSessionsAdded `🧪 experimental`

Triggered when the initial set of device bound sessions is added.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sessions` | array of [DeviceBoundSession](#deviceboundsession) | The device bound sessions. |


### <a name="deviceboundsessioneventoccurred"></a>deviceBoundSessionEventOccurred `🧪 experimental`

Triggered when a device bound session event occurs.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventId` | [DeviceBoundSessionEventId](#deviceboundsessioneventid) | A unique identifier for this session event. |
| `site` | `string` | The site this session event is associated with. |
| `succeeded` | `boolean` | Whether this event was considered successful. |
| `sessionId`<br/>_optional_ | `string` | The session ID this event is associated with. May not be populated for<br/>failed events. |
| `creationEventDetails`<br/>_optional_ | [CreationEventDetails](#creationeventdetails) | The below are the different session event type details. Exactly one is populated. |
| `refreshEventDetails`<br/>_optional_ | [RefreshEventDetails](#refresheventdetails) |  |
| `terminationEventDetails`<br/>_optional_ | [TerminationEventDetails](#terminationeventdetails) |  |
| `challengeEventDetails`<br/>_optional_ | [ChallengeEventDetails](#challengeeventdetails) |  |


