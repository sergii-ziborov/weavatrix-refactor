import fullSurface from './config-weavatrix-105.mjs'

export default {
  ...fullSurface,
  name: fullSurface.name.replace('1.0.5', '1.0.6-rename-profile'),
  args: [...fullSurface.args, '--profile=rename'],
}
