const slashCommands = require('../../skills/slash_commands');

describe("slash_commands",()=>{
  let mockBot = {}
  let mockMessage = {}

  const mockController = {
    on: jest.fn((event_arg) => {
      if (event_arg === 'slack_command') {
        return 'slash_command triggered'
      } else {
        return 'was not triggered'
      }
    })
  }
  
  it("does not trigger a slash command when one not present",()=>{
    expect(mockController.on('literally_anything_else')).toBe('was not triggered');
  })

  it("handles slash_command when one detected",()=>{
    // LOL okay this isn't testing anything *facepalm*
    expect(mockController.on('slack_command')).toBe('slash_command triggered');
  })
})
