# FedCm

`🧪 Experimental`

This domain allows interacting with the FedCM dialog.

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

### <a name="loginstate"></a>LoginState

Whether this is a sign-up or sign-in action for this account, i.e.
whether this account has ever been used to sign in to this RP before.

* **Type**: `string`
* **Allowed values**: `"SignIn"`, `"SignUp"`

### <a name="dialogtype"></a>DialogType

The types of FedCM dialogs.

* **Type**: `string`
* **Allowed values**: `"AccountChooser"`, `"AutoReauthn"`, `"ConfirmIdpLogin"`, `"Error"`

### <a name="dialogbutton"></a>DialogButton

The buttons on the FedCM dialog.

* **Type**: `string`
* **Allowed values**: `"ConfirmIdpLoginContinue"`, `"ErrorGotIt"`, `"ErrorMoreDetails"`

### <a name="accounturltype"></a>AccountUrlType

The URLs that each account has

* **Type**: `string`
* **Allowed values**: `"TermsOfService"`, `"PrivacyPolicy"`

### <a name="account"></a>Account

Corresponds to IdentityRequestAccount

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `accountId` | `string` |  |
| `email` | `string` |  |
| `name` | `string` |  |
| `givenName` | `string` |  |
| `pictureUrl` | `string` |  |
| `idpConfigUrl` | `string` |  |
| `idpLoginUrl` | `string` |  |
| `loginState` | [LoginState](#loginstate) |  |
| `termsOfServiceUrl`<br/>_optional_ | `string` | These two are only set if the loginState is signUp |
| `privacyPolicyUrl`<br/>_optional_ | `string` |  |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `disableRejectionDelay`<br/>_optional_ | `boolean` | Allows callers to disable the promise rejection delay that would<br/>normally happen, if this is unimportant to what's being tested.<br/>(step 4 of https://fedidcg.github.io/FedCM/#browser-api-rp-sign-in) |

* **Returns**: None


### <a name="disable"></a>disable

* **Parameters**: None

* **Returns**: None


### <a name="selectaccount"></a>selectAccount

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `dialogId` | `string` |  |
| `accountIndex` | `integer` |  |

* **Returns**: None


### <a name="clickdialogbutton"></a>clickDialogButton

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `dialogId` | `string` |  |
| `dialogButton` | [DialogButton](#dialogbutton) |  |

* **Returns**: None


### <a name="openurl"></a>openUrl

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `dialogId` | `string` |  |
| `accountIndex` | `integer` |  |
| `accountUrlType` | [AccountUrlType](#accounturltype) |  |

* **Returns**: None


### <a name="dismissdialog"></a>dismissDialog

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `dialogId` | `string` |  |
| `triggerCooldown`<br/>_optional_ | `boolean` |  |

* **Returns**: None


### <a name="resetcooldown"></a>resetCooldown

Resets the cooldown time, if any, to allow the next FedCM call to show
a dialog even if one was recently dismissed by the user.

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="dialogshown"></a>dialogShown

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `dialogId` | `string` |  |
| `dialogType` | [DialogType](#dialogtype) |  |
| `accounts` | array of [Account](#account) |  |
| `title` | `string` | These exist primarily so that the caller can verify the<br/>RP context was used appropriately. |
| `subtitle`<br/>_optional_ | `string` |  |


### <a name="dialogclosed"></a>dialogClosed

Triggered when a dialog is closed, either by user action, JS abort,
or a command below.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `dialogId` | `string` |  |


