# BluetoothEmulation

`🧪 Experimental`

This domain allows configuring virtual Bluetooth devices to test
the web-bluetooth API.

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

### <a name="centralstate"></a>CentralState

Indicates the various states of Central.

* **Type**: `string`
* **Allowed values**: `"absent"`, `"powered-off"`, `"powered-on"`

### <a name="gattoperationtype"></a>GATTOperationType

Indicates the various types of GATT event.

* **Type**: `string`
* **Allowed values**: `"connection"`, `"discovery"`

### <a name="characteristicwritetype"></a>CharacteristicWriteType

Indicates the various types of characteristic write.

* **Type**: `string`
* **Allowed values**: `"write-default-deprecated"`, `"write-with-response"`, `"write-without-response"`

### <a name="characteristicoperationtype"></a>CharacteristicOperationType

Indicates the various types of characteristic operation.

* **Type**: `string`
* **Allowed values**: `"read"`, `"write"`, `"subscribe-to-notifications"`, `"unsubscribe-from-notifications"`

### <a name="descriptoroperationtype"></a>DescriptorOperationType

Indicates the various types of descriptor operation.

* **Type**: `string`
* **Allowed values**: `"read"`, `"write"`

### <a name="manufacturerdata"></a>ManufacturerData

Stores the manufacturer data

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | `integer` | Company identifier<br/>https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/company_identifiers/company_identifiers.yaml<br/>https://usb.org/developers |
| `data` | `string` | Manufacturer-specific data (Encoded as a base64 string when passed over JSON) |


### <a name="scanrecord"></a>ScanRecord

Stores the byte data of the advertisement packet sent by a Bluetooth device.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name`<br/>_optional_ | `string` |  |
| `uuids`<br/>_optional_ | array of `string` |  |
| `appearance`<br/>_optional_ | `integer` | Stores the external appearance description of the device. |
| `txPower`<br/>_optional_ | `integer` | Stores the transmission power of a broadcasting device. |
| `manufacturerData`<br/>_optional_ | array of [ManufacturerData](#manufacturerdata) | Key is the company identifier and the value is an array of bytes of<br/>manufacturer specific data. |


### <a name="scanentry"></a>ScanEntry

Stores the advertisement packet information that is sent by a Bluetooth device.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `deviceAddress` | `string` |  |
| `rssi` | `integer` |  |
| `scanRecord` | [ScanRecord](#scanrecord) |  |


### <a name="characteristicproperties"></a>CharacteristicProperties

Describes the properties of a characteristic. This follows Bluetooth Core
Specification BT 4.2 Vol 3 Part G 3.3.1. Characteristic Properties.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `broadcast`<br/>_optional_ | `boolean` |  |
| `read`<br/>_optional_ | `boolean` |  |
| `writeWithoutResponse`<br/>_optional_ | `boolean` |  |
| `write`<br/>_optional_ | `boolean` |  |
| `notify`<br/>_optional_ | `boolean` |  |
| `indicate`<br/>_optional_ | `boolean` |  |
| `authenticatedSignedWrites`<br/>_optional_ | `boolean` |  |
| `extendedProperties`<br/>_optional_ | `boolean` |  |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Enable the BluetoothEmulation domain.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `state` | [CentralState](#centralstate) | State of the simulated central. |
| `leSupported` | `boolean` | If the simulated central supports low-energy. |

* **Returns**: None


### <a name="setsimulatedcentralstate"></a>setSimulatedCentralState

Set the state of the simulated central.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `state` | [CentralState](#centralstate) | State of the simulated central. |

* **Returns**: None


### <a name="disable"></a>disable

Disable the BluetoothEmulation domain.

* **Parameters**: None

* **Returns**: None


### <a name="simulatepreconnectedperipheral"></a>simulatePreconnectedPeripheral

Simulates a peripheral with |address|, |name| and |knownServiceUuids|
that has already been connected to the system.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `address` | `string` |  |
| `name` | `string` |  |
| `manufacturerData` | array of [ManufacturerData](#manufacturerdata) |  |
| `knownServiceUuids` | array of `string` |  |

* **Returns**: None


### <a name="simulateadvertisement"></a>simulateAdvertisement

Simulates an advertisement packet described in |entry| being received by
the central.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `entry` | [ScanEntry](#scanentry) |  |

* **Returns**: None


### <a name="simulategattoperationresponse"></a>simulateGATTOperationResponse

Simulates the response code from the peripheral with |address| for a
GATT operation of |type|. The |code| value follows the HCI Error Codes from
Bluetooth Core Specification Vol 2 Part D 1.3 List Of Error Codes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `address` | `string` |  |
| `type` | [GATTOperationType](#gattoperationtype) |  |
| `code` | `integer` |  |

* **Returns**: None


### <a name="simulatecharacteristicoperationresponse"></a>simulateCharacteristicOperationResponse

Simulates the response from the characteristic with |characteristicId| for a
characteristic operation of |type|. The |code| value follows the Error
Codes from Bluetooth Core Specification Vol 3 Part F 3.4.1.1 Error Response.
The |data| is expected to exist when simulating a successful read operation
response.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `characteristicId` | `string` |  |
| `type` | [CharacteristicOperationType](#characteristicoperationtype) |  |
| `code` | `integer` |  |
| `data`<br/>_optional_ | `string` |  |

* **Returns**: None


### <a name="simulatedescriptoroperationresponse"></a>simulateDescriptorOperationResponse

Simulates the response from the descriptor with |descriptorId| for a
descriptor operation of |type|. The |code| value follows the Error
Codes from Bluetooth Core Specification Vol 3 Part F 3.4.1.1 Error Response.
The |data| is expected to exist when simulating a successful read operation
response.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `descriptorId` | `string` |  |
| `type` | [DescriptorOperationType](#descriptoroperationtype) |  |
| `code` | `integer` |  |
| `data`<br/>_optional_ | `string` |  |

* **Returns**: None


### <a name="addservice"></a>addService

Adds a service with |serviceUuid| to the peripheral with |address|.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `address` | `string` |  |
| `serviceUuid` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `serviceId` | `string` | An identifier that uniquely represents this service. |


### <a name="removeservice"></a>removeService

Removes the service respresented by |serviceId| from the simulated central.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `serviceId` | `string` |  |

* **Returns**: None


### <a name="addcharacteristic"></a>addCharacteristic

Adds a characteristic with |characteristicUuid| and |properties| to the
service represented by |serviceId|.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `serviceId` | `string` |  |
| `characteristicUuid` | `string` |  |
| `properties` | [CharacteristicProperties](#characteristicproperties) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `characteristicId` | `string` | An identifier that uniquely represents this characteristic. |


### <a name="removecharacteristic"></a>removeCharacteristic

Removes the characteristic respresented by |characteristicId| from the
simulated central.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `characteristicId` | `string` |  |

* **Returns**: None


### <a name="adddescriptor"></a>addDescriptor

Adds a descriptor with |descriptorUuid| to the characteristic respresented
by |characteristicId|.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `characteristicId` | `string` |  |
| `descriptorUuid` | `string` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `descriptorId` | `string` | An identifier that uniquely represents this descriptor. |


### <a name="removedescriptor"></a>removeDescriptor

Removes the descriptor with |descriptorId| from the simulated central.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `descriptorId` | `string` |  |

* **Returns**: None


### <a name="simulategattdisconnection"></a>simulateGATTDisconnection

Simulates a GATT disconnection from the peripheral with |address|.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `address` | `string` |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="gattoperationreceived"></a>gattOperationReceived

Event for when a GATT operation of |type| to the peripheral with |address|
happened.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `address` | `string` |  |
| `type` | [GATTOperationType](#gattoperationtype) |  |


### <a name="characteristicoperationreceived"></a>characteristicOperationReceived

Event for when a characteristic operation of |type| to the characteristic
respresented by |characteristicId| happened. |data| and |writeType| is
expected to exist when |type| is write.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `characteristicId` | `string` |  |
| `type` | [CharacteristicOperationType](#characteristicoperationtype) |  |
| `data`<br/>_optional_ | `string` |  |
| `writeType`<br/>_optional_ | [CharacteristicWriteType](#characteristicwritetype) |  |


### <a name="descriptoroperationreceived"></a>descriptorOperationReceived

Event for when a descriptor operation of |type| to the descriptor
respresented by |descriptorId| happened. |data| is expected to exist when
|type| is write.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `descriptorId` | `string` |  |
| `type` | [DescriptorOperationType](#descriptoroperationtype) |  |
| `data`<br/>_optional_ | `string` |  |


