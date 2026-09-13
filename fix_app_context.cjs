const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  `      if (!hasCheckedContext) {
        const memberships = await getMyFamilyMemberships();
        if (memberships.length > 1) {
          setNeedsContextSelection(true);
          setLoading(false);
          return;
        }
      }`,
  `      if (!hasCheckedContext) {
        const memberships = await getMyFamilyMemberships();
        if (memberships.length > 0) {
          setNeedsContextSelection(true);
          setLoading(false);
          return;
        }
      }`
);

fs.writeFileSync('src/App.tsx', code);
