const fs = require('fs');
let code = fs.readFileSync('src/types/database.types.ts', 'utf8');

const correctFunctions = `    Functions: {
      create_family_invite: {
        Args: Record<string, never>
        Returns: { invite_id: string, token: string, expires_at: string }
      }
      accept_family_invite: {
        Args: { p_token: string }
        Returns: { success: boolean, family_id: string }
      }
      revoke_family_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      set_active_family: {
        Args: { p_family_id: string }
        Returns: undefined
      }
      remove_family_member: {
        Args: { p_user_id: string, p_family_id: string }
        Returns: undefined
      }
    }`;

code = code.replace(/    Functions: \{[\s\S]*?    \}/, correctFunctions);

fs.writeFileSync('src/types/database.types.ts', code);
