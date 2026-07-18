# WebAuthn

`🧪 Experimental`

This domain allows configuring virtual authenticators to test the WebAuthn
API.

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

### <a name="authenticatorid"></a>AuthenticatorId

* **Type**: `string`

### <a name="authenticatorprotocol"></a>AuthenticatorProtocol

* **Type**: `string`
* **Allowed values**: `"u2f"`, `"ctap2"`

### <a name="ctap2version"></a>Ctap2Version

* **Type**: `string`
* **Allowed values**: `"ctap2_0"`, `"ctap2_1"`, `"ctap2_2"`

### <a name="authenticatortransport"></a>AuthenticatorTransport

* **Type**: `string`
* **Allowed values**: `"usb"`, `"nfc"`, `"ble"`, `"cable"`, `"internal"`

### <a name="virtualauthenticatoroptions"></a>VirtualAuthenticatorOptions

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `protocol` | [AuthenticatorProtocol](#authenticatorprotocol) |  |
| `ctap2Version`<br/>_optional_ | [Ctap2Version](#ctap2version) | Defaults to ctap2_0. Ignored if \|protocol\| == u2f. |
| `transport` | [AuthenticatorTransport](#authenticatortransport) |  |
| `hasResidentKey`<br/>_optional_ | `boolean` | Defaults to false. |
| `hasUserVerification`<br/>_optional_ | `boolean` | Defaults to false. |
| `hasLargeBlob`<br/>_optional_ | `boolean` | If set to true, the authenticator will support the largeBlob extension.<br/>https://w3c.github.io/webauthn#largeBlob<br/>Defaults to false. |
| `hasCredBlob`<br/>_optional_ | `boolean` | If set to true, the authenticator will support the credBlob extension.<br/>https://fidoalliance.org/specs/fido-v2.1-rd-20201208/fido-client-to-authenticator-protocol-v2.1-rd-20201208.html#sctn-credBlob-extension<br/>Defaults to false. |
| `hasMinPinLength`<br/>_optional_ | `boolean` | If set to true, the authenticator will support the minPinLength extension.<br/>https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-20210615.html#sctn-minpinlength-extension<br/>Defaults to false. |
| `hasPrf`<br/>_optional_ | `boolean` | If set to true, the authenticator will support the prf extension.<br/>https://w3c.github.io/webauthn/#prf-extension<br/>Defaults to false. |
| `hasHmacSecret`<br/>_optional_ | `boolean` | If set to true, the authenticator will support the hmac-secret extension.<br/>https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-20210615.html#sctn-hmac-secret-extension<br/>Defaults to false. |
| `hasHmacSecretMc`<br/>_optional_ | `boolean` | If set to true, the authenticator will support the hmac-secret-mc extension.<br/>https://fidoalliance.org/specs/fido-v2.2-rd-20241003/fido-client-to-authenticator-protocol-v2.2-rd-20241003.html#sctn-hmac-secret-make-cred-extension<br/>Defaults to false. |
| `automaticPresenceSimulation`<br/>_optional_ | `boolean` | If set to true, tests of user presence will succeed immediately.<br/>Otherwise, they will not be resolved. Defaults to true. |
| `isUserVerified`<br/>_optional_ | `boolean` | Sets whether User Verification succeeds or fails for an authenticator.<br/>Defaults to false. |
| `defaultBackupEligibility`<br/>_optional_ | `boolean` | Credentials created by this authenticator will have the backup<br/>eligibility (BE) flag set to this value. Defaults to false.<br/>https://w3c.github.io/webauthn/#sctn-credential-backup |
| `defaultBackupState`<br/>_optional_ | `boolean` | Credentials created by this authenticator will have the backup state<br/>(BS) flag set to this value. Defaults to false.<br/>https://w3c.github.io/webauthn/#sctn-credential-backup |


### <a name="credential"></a>Credential

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `credentialId` | `string` |  |
| `isResidentCredential` | `boolean` |  |
| `rpId`<br/>_optional_ | `string` | Relying Party ID the credential is scoped to. Must be set when adding a<br/>credential. |
| `privateKey` | `string` | The ECDSA P-256 private key in PKCS#8 format. (Encoded as a base64 string when passed over JSON) |
| `userHandle`<br/>_optional_ | `string` | An opaque byte sequence with a maximum size of 64 bytes mapping the<br/>credential to a specific user. (Encoded as a base64 string when passed over JSON) |
| `signCount` | `integer` | Signature counter. This is incremented by one for each successful<br/>assertion.<br/>See https://w3c.github.io/webauthn/#signature-counter |
| `largeBlob`<br/>_optional_ | `string` | The large blob associated with the credential.<br/>See https://w3c.github.io/webauthn/#sctn-large-blob-extension (Encoded as a base64 string when passed over JSON) |
| `backupEligibility`<br/>_optional_ | `boolean` | Assertions returned by this credential will have the backup eligibility<br/>(BE) flag set to this value. Defaults to the authenticator's<br/>defaultBackupEligibility value. |
| `backupState`<br/>_optional_ | `boolean` | Assertions returned by this credential will have the backup state (BS)<br/>flag set to this value. Defaults to the authenticator's<br/>defaultBackupState value. |
| `userName`<br/>_optional_ | `string` | The credential's user.name property. Equivalent to empty if not set.<br/>https://w3c.github.io/webauthn/#dom-publickeycredentialentity-name |
| `userDisplayName`<br/>_optional_ | `string` | The credential's user.displayName property. Equivalent to empty if<br/>not set.<br/>https://w3c.github.io/webauthn/#dom-publickeycredentialuserentity-displayname |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Enable the WebAuthn domain and start intercepting credential storage and
retrieval with a virtual authenticator.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enableUI`<br/>_optional_ | `boolean` | Whether to enable the WebAuthn user interface. Enabling the UI is<br/>recommended for debugging and demo purposes, as it is closer to the real<br/>experience. Disabling the UI is recommended for automated testing.<br/>Supported at the embedder's discretion if UI is available.<br/>Defaults to false. |

* **Returns**: None


### <a name="disable"></a>disable

Disable the WebAuthn domain.

* **Parameters**: None

* **Returns**: None


### <a name="addvirtualauthenticator"></a>addVirtualAuthenticator

Creates and adds a virtual authenticator.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `options` | [VirtualAuthenticatorOptions](#virtualauthenticatoroptions) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |


### <a name="setresponseoverridebits"></a>setResponseOverrideBits

Resets parameters isBogusSignature, isBadUV, isBadUP to false if they are not present.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `isBogusSignature`<br/>_optional_ | `boolean` | If isBogusSignature is set, overrides the signature in the authenticator response to be zero.<br/>Defaults to false. |
| `isBadUV`<br/>_optional_ | `boolean` | If isBadUV is set, overrides the UV bit in the flags in the authenticator response to<br/>be zero. Defaults to false. |
| `isBadUP`<br/>_optional_ | `boolean` | If isBadUP is set, overrides the UP bit in the flags in the authenticator response to<br/>be zero. Defaults to false. |

* **Returns**: None


### <a name="removevirtualauthenticator"></a>removeVirtualAuthenticator

Removes the given authenticator.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |

* **Returns**: None


### <a name="addcredential"></a>addCredential

Adds the credential to the specified authenticator.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `credential` | [Credential](#credential) |  |

* **Returns**: None


### <a name="getcredential"></a>getCredential

Returns a single credential stored in the given virtual authenticator that
matches the credential ID.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `credentialId` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `credential` | [Credential](#credential) |  |


### <a name="getcredentials"></a>getCredentials

Returns all the credentials stored in the given virtual authenticator.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `credentials` | array of [Credential](#credential) |  |


### <a name="removecredential"></a>removeCredential

Removes a credential from the authenticator.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `credentialId` | `string` |  |

* **Returns**: None


### <a name="clearcredentials"></a>clearCredentials

Clears all the credentials from the specified device.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |

* **Returns**: None


### <a name="setuserverified"></a>setUserVerified

Sets whether User Verification succeeds or fails for an authenticator.
The default is true.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `isUserVerified` | `boolean` |  |

* **Returns**: None


### <a name="setautomaticpresencesimulation"></a>setAutomaticPresenceSimulation

Sets whether tests of user presence will succeed immediately (if true) or fail to resolve (if false) for an authenticator.
The default is true.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `enabled` | `boolean` |  |

* **Returns**: None


### <a name="setcredentialproperties"></a>setCredentialProperties

Allows setting credential properties.
https://w3c.github.io/webauthn/#sctn-automation-set-credential-properties

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `credentialId` | `string` |  |
| `backupEligibility`<br/>_optional_ | `boolean` |  |
| `backupState`<br/>_optional_ | `boolean` |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="credentialadded"></a>credentialAdded

Triggered when a credential is added to an authenticator.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `credential` | [Credential](#credential) |  |


### <a name="credentialdeleted"></a>credentialDeleted

Triggered when a credential is deleted, e.g. through
PublicKeyCredential.signalUnknownCredential().

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `credentialId` | `string` |  |


### <a name="credentialupdated"></a>credentialUpdated

Triggered when a credential is updated, e.g. through
PublicKeyCredential.signalCurrentUserDetails().

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `credential` | [Credential](#credential) |  |


### <a name="credentialasserted"></a>credentialAsserted

Triggered when a credential is used in a webauthn assertion.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `authenticatorId` | [AuthenticatorId](#authenticatorid) |  |
| `credential` | [Credential](#credential) |  |


