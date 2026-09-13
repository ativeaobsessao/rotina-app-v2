const fs = require('fs');
let code = fs.readFileSync('src/components/ui/UserProfile.tsx', 'utf8');

// Add createPortal import
if (!code.includes('createPortal')) {
  code = code.replace(/import React, { (.*?) } from 'react';/, "import React, { $1 } from 'react';\nimport { createPortal } from 'react-dom';");
  // If it didn't have React imports like that, just add it at the top
  if (!code.includes('createPortal')) {
     code = "import { createPortal } from 'react-dom';\n" + code;
  }
}

// Replace the FamilyModal rendering
code = code.replace(
  /\{showFamilyModal && profile\?\.family_id && \(\s*<FamilyModal\s*familyId=\{profile\.family_id\}\s*currentUserId=\{profile\.id\}\s*onClose=\{\(\) => setShowFamilyModal\(false\)\}\s*\/>\s*\)\}/,
  `{showFamilyModal && profile?.family_id && createPortal(
        <FamilyModal 
          familyId={profile.family_id} 
          currentUserId={profile.id}
          onClose={() => setShowFamilyModal(false)} 
        />,
        document.body
      )}`
);

fs.writeFileSync('src/components/ui/UserProfile.tsx', code);
