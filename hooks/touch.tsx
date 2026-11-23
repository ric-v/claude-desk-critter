import type { ClientModule } from 'claude-code'

/**
 * The critter's strip, made clickable: an empty region over it that posts which cell was pressed.
 * The hooks module decides whether that cell was the critter.
 */
const Touch: ClientModule = (_props, surface) => {
  if (surface.state === undefined) {
    surface.onPointer(e => {
      if (e.type === 'down') surface.post({ x: Math.floor(e.x), y: e.y })
    })
    surface.setState(true)
  }
  const { Box } = surface.elements
  return <Box width={surface.columns || 1} height={surface.rows || 1} />
}

export default Touch
