const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// The logic inside checkPatient currently has:
/*
      if (!hasCheckedContext) {
        try {
          const memberships = await getMyFamilyMemberships();
          if (memberships.length > 0) {
            const currentValid = memberships.some(m => m.family_id === prof.family_id);
            if (memberships.length === 1 && currentValid) {
              // Auto-select and skip the screen to restore original flow!
              setHasCheckedContext(true);
            } else {
              setNeedsContextSelection(true);
              setLoading(false);
              return;
            }
          } else {
            setHasCheckedContext(true);
          }
        } catch (err) {
          console.error('Error fetching memberships, falling back to basic flow:', err);
          setHasCheckedContext(true);
        }
      }
*/

const oldLogic = `      if (!hasCheckedContext) {
        try {
          const memberships = await getMyFamilyMemberships();
          if (memberships.length > 0) {
            const currentValid = memberships.some(m => m.family_id === prof.family_id);
            if (memberships.length === 1 && currentValid) {
              // Auto-select and skip the screen to restore original flow!
              setHasCheckedContext(true);
            } else {
              setNeedsContextSelection(true);
              setLoading(false);
              return;
            }
          } else {
            setHasCheckedContext(true);
          }
        } catch (err) {
          console.error('Error fetching memberships, falling back to basic flow:', err);
          setHasCheckedContext(true);
        }
      }`;

const newLogic = `      if (!hasCheckedContext) {
        setNeedsContextSelection(true);
        setLoading(false);
        return;
      }`;

code = code.replace(oldLogic, newLogic);
fs.writeFileSync('src/App.tsx', code);
