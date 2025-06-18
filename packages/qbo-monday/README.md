# @import-af/qbo-monday

Synchronization utilities between QuickBooks Online and Monday.com

## Installation

```bash
npm install @import-af/qbo-monday
```

## Usage

```javascript
const { hello } = require('@import-af/qbo-monday');

console.log(hello()); // Hello from @import-af/qbo-monday!
```


### Configuration Parsing

\`\`\`javascript
const { parseConfig } = require('@import-af/$pkg_name');

const configJson = JSON.stringify({
  qboEntity: 'customer',
  mondayBoardId: 123456,
  mappings: [
    { qboField: 'Name', mondayColumn: 'client_name' }
  ]
});

const config = parseConfig(configJson);
console.log(config);
\`\`\`

## License

MIT © [Import AF](https://import-af.com)
