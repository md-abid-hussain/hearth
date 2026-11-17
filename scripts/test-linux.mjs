// Tests the Linux build locally with Docker (npm run test:linux): builds the image in
// docker/linux.Dockerfile, runs the smoke test inside it, and copies the screenshots it took to
// smoke-shots/. Needs Docker Desktop or any Docker engine that runs Linux containers.
import { spawnSync } from 'child_process'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const IMAGE = 'hearth-linux-test'
const CONTAINER = 'hearth-linux-test-run'
const run = (args) => {
  console.log(`\n> docker ${args.join(' ')}`)
  return spawnSync('docker', args, { stdio: 'inherit' }).status ?? 1
}

if (run(['build', '-f', 'docker/linux.Dockerfile', '-t', IMAGE, '.']) !== 0) process.exit(1)
spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
const status = run(['run', '--name', CONTAINER, IMAGE])
mkdirSync('smoke-shots', { recursive: true })
run(['cp', `${CONTAINER}:/app/smoke-shots/.`, resolve('smoke-shots')])
spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
console.log(status === 0 ? '\nLinux test passed.' : '\nLinux test failed.')
process.exit(status)
