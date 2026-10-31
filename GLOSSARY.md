# Browser-CLI Core Domain

Browser-CLI provides browser automation, dynamic reverse engineering, network inspection, and debugging capabilities over the Chrome DevTools Protocol and Patchright.

## Language

**Navigation Bucket**:
A discrete, chronological container of network requests and traffic events recorded during a single page navigation lifecycle.
_Avoid_: Request group, page history segment, navigation log, request pool

**Request Initiator**:
The origin declaration and immediate call stack describing why and where the browser dispatched a network request or opened a connection.
_Avoid_: Caller stack, request origin, trigger source, stack trace parent
