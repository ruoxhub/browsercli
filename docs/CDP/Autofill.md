# Autofill

`🧪 Experimental`

Defines commands and events for Autofill.

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

### <a name="creditcard"></a>CreditCard

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `number` | `string` | 16-digit credit card number. |
| `name` | `string` | Name of the credit card owner. |
| `expiryMonth` | `string` | 2-digit expiry month. |
| `expiryYear` | `string` | 4-digit expiry year. |
| `cvc` | `string` | 3-digit card verification code. |


### <a name="addressfield"></a>AddressField

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | address field name, for example GIVEN_NAME.<br/>The full list of supported field names:<br/>https://source.chromium.org/chromium/chromium/src/+/main:components/autofill/core/browser/field_types.cc;l=38 |
| `value` | `string` | address field value, for example Jon Doe. |


### <a name="addressfields"></a>AddressFields

A list of address fields.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `fields` | array of [AddressField](#addressfield) |  |


### <a name="address"></a>Address

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `fields` | array of [AddressField](#addressfield) | fields and values defining an address. |


### <a name="addressui"></a>AddressUI

Defines how an address can be displayed like in chrome://settings/addresses.
Address UI is a two dimensional array, each inner array is an "address information line", and when rendered in a UI surface should be displayed as such.
The following address UI for instance:
[[{name: "GIVE_NAME", value: "Jon"}, {name: "FAMILY_NAME", value: "Doe"}], [{name: "CITY", value: "Munich"}, {name: "ZIP", value: "81456"}]]
should allow the receiver to render:
Jon Doe
Munich 81456

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `addressFields` | array of [AddressFields](#addressfields) | A two dimension array containing the representation of values from an address profile. |


### <a name="fillingstrategy"></a>FillingStrategy

Specified whether a filled field was done so by using the html autocomplete attribute or autofill heuristics.

* **Type**: `string`
* **Allowed values**: `"autocompleteAttribute"`, `"autofillInferred"`

### <a name="filledfield"></a>FilledField

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `htmlType` | `string` | The type of the field, e.g text, password etc. |
| `id` | `string` | the html id |
| `name` | `string` | the html name |
| `value` | `string` | the field value |
| `autofillType` | `string` | The actual field type, e.g FAMILY_NAME |
| `fillingStrategy` | [FillingStrategy](#fillingstrategy) | The filling strategy |
| `frameId` | [Page.FrameId](Page.md#frameid) | The frame the field belongs to |
| `fieldId` | [DOM.BackendNodeId](DOM.md#backendnodeid) | The form field's DOM node |


---

<a name="commands"></a>
## Commands

### <a name="trigger"></a>trigger

Trigger autofill on a form identified by the fieldId.
If the field and related form cannot be autofilled, returns an error.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `fieldId` | [DOM.BackendNodeId](DOM.md#backendnodeid) | Identifies a field that serves as an anchor for autofill. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | Identifies the frame that field belongs to. |
| `card`<br/>_optional_ | [CreditCard](#creditcard) | Credit card information to fill out the form. Credit card data is not saved.  Mutually exclusive with `address`. |
| `address`<br/>_optional_ | [Address](#address) | Address to fill out the form. Address data is not saved. Mutually exclusive with `card`. |

* **Returns**: None


### <a name="setaddresses"></a>setAddresses

Set addresses so that developers can verify their forms implementation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `addresses` | array of [Address](#address) |  |

* **Returns**: None


### <a name="disable"></a>disable

Disables autofill domain notifications.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables autofill domain notifications.

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="addressformfilled"></a>addressFormFilled

Emitted when an address form is filled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `filledFields` | array of [FilledField](#filledfield) | Information about the fields that were filled |
| `addressUi` | [AddressUI](#addressui) | An UI representation of the address used to fill the form.<br/>Consists of a 2D array where each child represents an address/profile line. |


