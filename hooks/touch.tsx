import type { ClientModule } from 'claude-code'

/**
 * The critter's strip, made touchable: an empty region over it that posts where the pointer is and
 * what it did, with the fraction of a cell where the terminal reports one. `held` says whether a
 * button is down, so the hooks module can tell a drag from a hover even when a post is dropped.
 * The hooks module decides what that was to the critter.
 */
const Touch: ClientModule = (_props, surface) => {
  if (surface.state === undefined) {
    surface.onPointer(e => {
      if (e.type === 'enter') return
      // A move carries its button only while one is down.
      const held = e.type === 'down' || (e.type === 'move' && e.button !== undefined)
      const x = e.fine?.x ?? e.x + 0.5
      const y = e.fine?.y ?? e.y + 0.5
      surface.post({ t: e.type, x, y, held })
    })
    surface.setState(true)
  }
  const { Box } = surface.elements
  return <Box width={surface.columns || 1} height={surface.rows || 1} />
}

export default Touch
