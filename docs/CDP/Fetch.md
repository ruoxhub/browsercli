# Fetch

A domain for letting clients substitute browser's network layer with client code.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Network](Network.md), [IO](IO.md), [Page](Page.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="requestid"></a>RequestId

Unique request identifier.
Note that this does not identify individual HTTP requests that are part of
a network request.

* **Type**: `string`

### <a name="requeststage"></a>RequestStage

Stages of the request to handle. Request will intercept before the request is
sent. Response will intercept after the response is received (but before response
body is received).

* **Type**: `string`
* **Allowed values**: `"Request"`, `"Response"`

### <a name="requestpattern"></a>RequestPattern

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `urlPattern`<br/>_optional_ | `string` | Wildcards (`'*'` -> zero or more, `'?'` -> exactly one) are allowed. Escape character is<br/>backslash. Omitting is equivalent to `"*"`. |
| `resourceType`<br/>_optional_ | [Network.ResourceType](Network.md#resourcetype) | If set, only requests for matching resource types will be intercepted. |
| `requestStage`<br/>_optional_ | [RequestStage](#requeststage) | Stage at which to begin intercepting requests. Default is Request. |


### <a name="headerentry"></a>HeaderEntry

Response HTTP header entry

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `value` | `string` |  |


### <a name="authchallenge"></a>AuthChallenge

Authorization challenge for HTTP status code 401 or 407.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `source`<br/>_optional_ | `string` | Source of the authentication challenge.<br/>Allowed values: `"Server"`, `"Proxy"` |
| `origin` | `string` | Origin of the challenger. |
| `scheme` | `string` | The authentication scheme used, such as basic or digest |
| `realm` | `string` | The realm of the challenge. May be empty. |


### <a name="authchallengeresponse"></a>AuthChallengeResponse

Response to an AuthChallenge.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `response` | `string` | The decision on what to do in response to the authorization challenge.  Default means<br/>deferring to the default behavior of the net stack, which will likely either the Cancel<br/>authentication or display a popup dialog box.<br/>Allowed values: `"Default"`, `"CancelAuth"`, `"ProvideCredentials"` |
| `username`<br/>_optional_ | `string` | The username to provide, possibly empty. Should only be set if response is<br/>ProvideCredentials. |
| `password`<br/>_optional_ | `string` | The password to provide, possibly empty. Should only be set if response is<br/>ProvideCredentials. |


---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

Disables the fetch domain.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables issuing of requestPaused events. A request will be paused until client
calls one of failRequest, fulfillRequest or continueRequest/continueWithAuth.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `patterns`<br/>_optional_ | array of [RequestPattern](#requestpattern) | If specified, only requests matching any of these patterns will produce<br/>fetchRequested event and will be paused until clients response. If not set,<br/>all requests will be affected. |
| `handleAuthRequests`<br/>_optional_ | `boolean` | If true, authRequired events will be issued and requests will be paused<br/>expecting a call to continueWithAuth. |

* **Returns**: None


### <a name="failrequest"></a>failRequest

Causes the request to fail with specified reason.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | An id the client received in requestPaused event. |
| `errorReason` | [Network.ErrorReason](Network.md#errorreason) | Causes the request to fail with the given reason. |

* **Returns**: None


### <a name="fulfillrequest"></a>fulfillRequest

Provides response to the request.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | An id the client received in requestPaused event. |
| `responseCode` | `integer` | An HTTP response code. |
| `responseHeaders`<br/>_optional_ | array of [HeaderEntry](#headerentry) | Response headers. |
| `binaryResponseHeaders`<br/>_optional_ | `string` | Alternative way of specifying response headers as a \0-separated<br/>series of name: value pairs. Prefer the above method unless you<br/>need to represent some non-UTF8 values that can't be transmitted<br/>over the protocol as text. (Encoded as a base64 string when passed over JSON) |
| `body`<br/>_optional_ | `string` | A response body. If absent, original response body will be used if<br/>the request is intercepted at the response stage and empty body<br/>will be used if the request is intercepted at the request stage. (Encoded as a base64 string when passed over JSON) |
| `responsePhrase`<br/>_optional_ | `string` | A textual representation of responseCode.<br/>If absent, a standard phrase matching responseCode is used. |

* **Returns**: None


### <a name="continuerequest"></a>continueRequest

Continues the request, optionally modifying some of its parameters.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | An id the client received in requestPaused event. |
| `url`<br/>_optional_ | `string` | If set, the request url will be modified in a way that's not observable by page. |
| `method`<br/>_optional_ | `string` | If set, the request method is overridden. |
| `postData`<br/>_optional_ | `string` | If set, overrides the post data in the request. (Encoded as a base64 string when passed over JSON) |
| `headers`<br/>_optional_ | array of [HeaderEntry](#headerentry) | If set, overrides the request headers. Note that the overrides do not<br/>extend to subsequent redirect hops, if a redirect happens. Another override<br/>may be applied to a different request produced by a redirect. |
| `interceptResponse`<br/>_optional_ | `boolean` | `🧪 experimental` If set, overrides response interception behavior for this request. |

* **Returns**: None


### <a name="continuewithauth"></a>continueWithAuth

Continues a request supplying authChallengeResponse following authRequired event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | An id the client received in authRequired event. |
| `authChallengeResponse` | [AuthChallengeResponse](#authchallengeresponse) | Response to  with an authChallenge. |

* **Returns**: None


### <a name="continueresponse"></a>continueResponse `🧪 experimental`

Continues loading of the paused response, optionally modifying the
response headers. If either responseCode or headers are modified, all of them
must be present.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | An id the client received in requestPaused event. |
| `responseCode`<br/>_optional_ | `integer` | An HTTP response code. If absent, original response code will be used. |
| `responsePhrase`<br/>_optional_ | `string` | A textual representation of responseCode.<br/>If absent, a standard phrase matching responseCode is used. |
| `responseHeaders`<br/>_optional_ | array of [HeaderEntry](#headerentry) | Response headers. If absent, original response headers will be used. |
| `binaryResponseHeaders`<br/>_optional_ | `string` | Alternative way of specifying response headers as a \0-separated<br/>series of name: value pairs. Prefer the above method unless you<br/>need to represent some non-UTF8 values that can't be transmitted<br/>over the protocol as text. (Encoded as a base64 string when passed over JSON) |

* **Returns**: None


### <a name="getresponsebody"></a>getResponseBody

Causes the body of the response to be received from the server and
returned as a single string. May only be issued for a request that
is paused in the Response stage and is mutually exclusive with
takeResponseBodyForInterceptionAsStream. Calling other methods that
affect the request or disabling fetch domain before body is received
results in an undefined behavior.
Note that the response body is not available for redirects. Requests
paused in the _redirect received_ state may be differentiated by
`responseCode` and presence of `location` response header, see
comments to `requestPaused` for details.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Identifier for the intercepted request to get body for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `body` | `string` | Response body. |
| `base64Encoded` | `boolean` | True, if content was sent as base64. |


### <a name="takeresponsebodyasstream"></a>takeResponseBodyAsStream

Returns a handle to the stream representing the response body.
The request must be paused in the HeadersReceived stage.
Note that after this command the request can't be continued
as is -- client either needs to cancel it or to provide the
response body.
The stream only supports sequential read, IO.read will fail if the position
is specified.
This method is mutually exclusive with getResponseBody.
Calling other methods that affect the request or disabling fetch
domain before body is received results in an undefined behavior.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `stream` | [IO.StreamHandle](IO.md#streamhandle) |  |


---

<a name="events"></a>
## Events

### <a name="requestpaused"></a>requestPaused

Issued when the domain is enabled and the request URL matches the
specified filter. The request is paused until the client responds
with one of continueRequest, failRequest or fulfillRequest.
The stage of the request can be determined by presence of responseErrorReason
and responseStatusCode -- the request is at the response stage if either
of these fields is present and in the request stage otherwise.
Redirect responses and subsequent requests are reported similarly to regular
responses and requests. Redirect responses may be distinguished by the value
of `responseStatusCode` (which is one of 301, 302, 303, 307, 308) along with
presence of the `location` header. Requests resulting from a redirect will
have `redirectedRequestId` field set.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Each request the page makes will have a unique id. |
| `request` | [Network.Request](Network.md#request) | The details of the request. |
| `frameId` | [Page.FrameId](Page.md#frameid) | The id of the frame that initiated the request. |
| `resourceType` | [Network.ResourceType](Network.md#resourcetype) | How the requested resource will be used. |
| `responseErrorReason`<br/>_optional_ | [Network.ErrorReason](Network.md#errorreason) | Response error if intercepted at response stage. |
| `responseStatusCode`<br/>_optional_ | `integer` | Response code if intercepted at response stage. |
| `responseStatusText`<br/>_optional_ | `string` | Response status text if intercepted at response stage. |
| `responseHeaders`<br/>_optional_ | array of [HeaderEntry](#headerentry) | Response headers if intercepted at the response stage. |
| `networkId`<br/>_optional_ | [Network.RequestId](Network.md#requestid) | If the intercepted request had a corresponding Network.requestWillBeSent event fired for it,<br/>then this networkId will be the same as the requestId present in the requestWillBeSent event. |
| `redirectedRequestId`<br/>_optional_ | [RequestId](#requestid) | `🧪 experimental` If the request is due to a redirect response from the server, the id of the request that<br/>has caused the redirect. |


### <a name="authrequired"></a>authRequired

Issued when the domain is enabled with handleAuthRequests set to true.
The request is paused until client responds with continueWithAuth.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | [RequestId](#requestid) | Each request the page makes will have a unique id. |
| `request` | [Network.Request](Network.md#request) | The details of the request. |
| `frameId` | [Page.FrameId](Page.md#frameid) | The id of the frame that initiated the request. |
| `resourceType` | [Network.ResourceType](Network.md#resourcetype) | How the requested resource will be used. |
| `authChallenge` | [AuthChallenge](#authchallenge) | Details of the Authorization Challenge encountered.<br/>If this is set, client should respond with continueRequest that<br/>contains AuthChallengeResponse. |


