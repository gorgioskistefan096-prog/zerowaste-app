import fs from 'node:fs'
import path from 'node:path'
import solc from 'solc'

const sourcePath = path.resolve('contracts/ZeroWasteMarketplace.sol')
const source = fs.readFileSync(sourcePath, 'utf8')
const input = {
  language: 'Solidity',
  sources: { 'ZeroWasteMarketplace.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors || []).filter((error) => error.severity === 'error')
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage)
  process.exit(1)
}
const contract = output.contracts?.['ZeroWasteMarketplace.sol']?.ZeroWasteMarketplace
if (!contract?.evm?.bytecode?.object) throw new Error('Компилаторот не генерира bytecode.')

const artifactDirectory = path.resolve('artifacts')
fs.mkdirSync(artifactDirectory, { recursive: true })
fs.writeFileSync(path.join(artifactDirectory, 'ZeroWasteMarketplace.json'), JSON.stringify({
  contractName: 'ZeroWasteMarketplace',
  compilerVersion: solc.version(),
  evmVersion: 'cancun',
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
}, null, 2))
console.log(`ZeroWasteMarketplace е компајлиран со solc ${solc.version()}.`)
console.log('Артефакт: artifacts/ZeroWasteMarketplace.json')
