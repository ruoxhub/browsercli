# Security

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

### <a name="certificateid"></a>CertificateId

An internal certificate ID value.

* **Type**: `integer`

### <a name="mixedcontenttype"></a>MixedContentType

A description of mixed content (HTTP resources on HTTPS pages), as defined by
https://www.w3.org/TR/mixed-content/#categories

* **Type**: `string`
* **Allowed values**: `"blockable"`, `"optionally-blockable"`, `"none"`

### <a name="securitystate"></a>SecurityState

The security level of a page or resource.

* **Type**: `string`
* **Allowed values**: `"unknown"`, `"neutral"`, `"insecure"`, `"secure"`, `"info"`, `"insecure-broken"`

### <a name="certificatesecuritystate"></a>CertificateSecurityState `🧪 experimental`

Details about the security state of the page certificate.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `protocol` | `string` | Protocol name (e.g. "TLS 1.2" or "QUIC"). |
| `keyExchange` | `string` | Key Exchange used by the connection, or the empty string if not applicable. |
| `keyExchangeGroup`<br/>_optional_ | `string` | (EC)DH group used by the connection, if applicable. |
| `cipher` | `string` | Cipher name. |
| `mac`<br/>_optional_ | `string` | TLS MAC. Note that AEAD ciphers do not have separate MACs. |
| `certificate` | array of `string` | Page certificate. |
| `subjectName` | `string` | Certificate subject name. |
| `issuer` | `string` | Name of the issuing CA. |
| `validFrom` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Certificate valid from date. |
| `validTo` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Certificate valid to (expiration) date |
| `certificateNetworkError`<br/>_optional_ | `string` | The highest priority network error code, if the certificate has an error. |
| `certificateHasWeakSignature` | `boolean` | True if the certificate uses a weak signature algorithm. |
| `certificateHasSha1Signature` | `boolean` | True if the certificate has a SHA1 signature in the chain. |
| `modernSSL` | `boolean` | True if modern SSL |
| `obsoleteSslProtocol` | `boolean` | True if the connection is using an obsolete SSL protocol. |
| `obsoleteSslKeyExchange` | `boolean` | True if the connection is using an obsolete SSL key exchange. |
| `obsoleteSslCipher` | `boolean` | True if the connection is using an obsolete SSL cipher. |
| `obsoleteSslSignature` | `boolean` | True if the connection is using an obsolete SSL signature. |


### <a name="safetytipstatus"></a>SafetyTipStatus `🧪 experimental`

* **Type**: `string`
* **Allowed values**: `"badReputation"`, `"lookalike"`

### <a name="safetytipinfo"></a>SafetyTipInfo `🧪 experimental`

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `safetyTipStatus` | [SafetyTipStatus](#safetytipstatus) | Describes whether the page triggers any safety tips or reputation warnings. Default is unknown. |
| `safeUrl`<br/>_optional_ | `string` | The URL the safety tip suggested ("Did you mean?"). Only filled in for lookalike matches. |


### <a name="visiblesecuritystate"></a>VisibleSecurityState `🧪 experimental`

Security state information about the page.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `securityState` | [SecurityState](#securitystate) | The security level of the page. |
| `certificateSecurityState`<br/>_optional_ | [CertificateSecurityState](#certificatesecuritystate) | Security state details about the page certificate. |
| `safetyTipInfo`<br/>_optional_ | [SafetyTipInfo](#safetytipinfo) | The type of Safety Tip triggered on the page. Note that this field will be set even if the Safety Tip UI was not actually shown. |
| `securityStateIssueIds` | array of `string` | Array of security state issues ids. |


### <a name="securitystateexplanation"></a>SecurityStateExplanation

An explanation of an factor contributing to the security state.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `securityState` | [SecurityState](#securitystate) | Security state representing the severity of the factor being explained. |
| `title` | `string` | Title describing the type of factor. |
| `summary` | `string` | Short phrase describing the type of factor. |
| `description` | `string` | Full text explanation of the factor. |
| `mixedContentType` | [MixedContentType](#mixedcontenttype) | The type of mixed content described by the explanation. |
| `certificate` | array of `string` | Page certificate. |
| `recommendations`<br/>_optional_ | array of `string` | Recommendations to fix any issues. |


### <a name="insecurecontentstatus"></a>InsecureContentStatus `⚠️ deprecated`

Information about insecure content on the page.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `ranMixedContent` | `boolean` | Always false. |
| `displayedMixedContent` | `boolean` | Always false. |
| `containedMixedForm` | `boolean` | Always false. |
| `ranContentWithCertErrors` | `boolean` | Always false. |
| `displayedContentWithCertErrors` | `boolean` | Always false. |
| `ranInsecureContentStyle` | [SecurityState](#securitystate) | Always set to unknown. |
| `displayedInsecureContentStyle` | [SecurityState](#securitystate) | Always set to unknown. |


### <a name="certificateerroraction"></a>CertificateErrorAction

The action to take when a certificate error occurs. continue will continue processing the
request and cancel will cancel the request.

* **Type**: `string`
* **Allowed values**: `"continue"`, `"cancel"`

---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

Disables tracking security state changes.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables tracking security state changes.

* **Parameters**: None

* **Returns**: None


### <a name="setignorecertificateerrors"></a>setIgnoreCertificateErrors

Enable/disable whether all certificate errors should be ignored.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `ignore` | `boolean` | If true, all certificate errors will be ignored. |

* **Returns**: None


### <a name="handlecertificateerror"></a>handleCertificateError `⚠️ deprecated`

Handles a certificate error that fired a certificateError event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventId` | `integer` | The ID of the event. |
| `action` | [CertificateErrorAction](#certificateerroraction) | The action to take on the certificate error. |

* **Returns**: None


### <a name="setoverridecertificateerrors"></a>setOverrideCertificateErrors `⚠️ deprecated`

Enable/disable overriding certificate errors. If enabled, all certificate error events need to
be handled by the DevTools client and should be answered with `handleCertificateError` commands.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `override` | `boolean` | If true, certificate errors will be overridden. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="certificateerror"></a>certificateError `⚠️ deprecated`

There is a certificate error. If overriding certificate errors is enabled, then it should be
handled with the `handleCertificateError` command. Note: this event does not fire if the
certificate error has been allowed internally. Only one client per target should override
certificate errors at the same time.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventId` | `integer` | The ID of the event. |
| `errorType` | `string` | The type of the error. |
| `requestURL` | `string` | The url that was requested. |


### <a name="visiblesecuritystatechanged"></a>visibleSecurityStateChanged `🧪 experimental`

The security state of the page changed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `visibleSecurityState` | [VisibleSecurityState](#visiblesecuritystate) | Security state information about the page. |


### <a name="securitystatechanged"></a>securityStateChanged `⚠️ deprecated`

The security state of the page changed. No longer being sent.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `securityState` | [SecurityState](#securitystate) | Security state. |
| `schemeIsCryptographic` | `boolean` | `⚠️ deprecated` True if the page was loaded over cryptographic transport such as HTTPS. |
| `explanations` | array of [SecurityStateExplanation](#securitystateexplanation) | `⚠️ deprecated` Previously a list of explanations for the security state. Now always<br/>empty. |
| `insecureContentStatus` | [InsecureContentStatus](#insecurecontentstatus) | `⚠️ deprecated` Information about insecure content on the page. |
| `summary`<br/>_optional_ | `string` | `⚠️ deprecated` Overrides user-visible description of the state. Always omitted. |


