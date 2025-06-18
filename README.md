# pipedream-libs

🚀 Open-source automation libraries by Import AF. Modular NPM packages for seamless business system integrations, designed for PipeDream workflows and beyond.

## Packages

- **[@import-af/qbo](./packages/qbo)** - QuickBooks Online utilities
- **[@import-af/monday](./packages/monday)** - Monday.com utilities  
- **[@import-af/qbo-monday](./packages/qbo-monday)** - QBO ↔ Monday synchronization

## Quick Start

```bash
npm install @import-af/qbo @import-af/monday @import-af/qbo-monday
```

## Usage

```javascript
const { hello } = require('@import-af/qbo');
console.log(hello()); // Hello from @import-af/qbo!
```

## Development

```bash
# Install dependencies
npm install

# Publish all packages
npm run publish:all
```

## License

MIT © [Import AF](https://import-af.com)
