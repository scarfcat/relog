const Command = require('command')

module.exports = function Relog(dispatch) {
  const command = Command(dispatch)

  let positions = {},
      curr_char = -1

  command.add('relog', (name) => {
    if (!name) return
    getCharacterId(name)
      .then(relog)
      .catch(e => console.error(e.message))
  })

  // Grab the user list the first time the client sees the lobby
  dispatch.hookOnce('S_GET_USER_LIST', 9, event => updatePositions(event.characters))

  dispatch.hook('C_DELETE_USER', 'raw', () =>
    dispatch.hookOnce('S_GET_USER_LIST', 9, event => updatePositions(event.characters))
  )

  // Update positions on reorder
  dispatch.hook('C_CHANGE_USER_LOBBY_SLOT_ID', event => {
    updatePositions(event.characters)
    console.log('[relog] Character positions updated')
  })

  // Keep track of current char for relog nx
  dispatch.hook('C_SELECT_USER', 1, /*{order: 100, filter: {fake: null}},*/ event => {
    curr_char = positions[event.id]
    console.log('[relog] Char selected: ' + curr_char)
  })

  function send(msg) {
    command.message(' (relog): ' + msg)
  }

  function updatePositions(characters) {
    if (!characters) return
    positions = {}
    characters.forEach((char, i) => {
      let {id, position} = char
      positions[id] = position || (i+1)
    })
  }

  function getCharacterId(name) {
    return new Promise((resolve, reject) => {
      // request handler, resolves with character's playerId
      const userListHook = dispatch.hookOnce('S_GET_USER_LIST', 9, event => {
        name = name.toLowerCase()
        let index = (name === 'nx')? ++curr_char : parseInt(name)
        if (index && index > event.characters.length) index = 1
        event.characters.forEach((char, i) => {
          if (char.deletion) return
          let pos = char.position || (i+1)
          if (char.name.toLowerCase() === name || pos === index) resolve(char.id)
        })
        reject(new Error(`[relog] character "${name}" not found`))
      })

      // set a timeout for the request, in case something went wrong
      setTimeout(() => {
        if (userListHook) dispatch.unhook(userListHook)
        reject(new Error('[relog] C_GET_USER_LIST request timed out'))
      }, 5000)

      // request the character list
      dispatch.toServer('C_GET_USER_LIST', 1, {})
    })
  }

  function relog(targetId) {
    if (!targetId) return
    dispatch.toServer('C_RETURN_TO_LOBBY', 1, {})
    let userListHook
    let lobbyHook

    // make sure that the client is able to log out
    const prepareLobbyHook = dispatch.hookOnce('S_PREPARE_RETURN_TO_LOBBY', 1, () => {
      dispatch.toClient('S_RETURN_TO_LOBBY', 1, {})

      // the server is not ready yet, displaying "Loading..." as char names
      userListHook = dispatch.hookOnce('S_GET_USER_LIST', 9, event => {
        event.characters.forEach(char => char.name = 'Loading...')
        return true
      })

      // the server is ready to relog to a new character
      lobbyHook = dispatch.hookOnce('S_RETURN_TO_LOBBY', 1, () => {
        process.nextTick (() => dispatch.toServer('C_SELECT_USER', 1, { id: targetId, unk: 0 }))
      })
    })

    // hook timeout, in case something goes wrong
    setTimeout(() => {
      for (const hook of [prepareLobbyHook, lobbyHook, userListHook])
        if (hook) dispatch.unhook(hook)
    }, 15000)
  }
}
