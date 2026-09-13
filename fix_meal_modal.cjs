const fs = require('fs');
let code = fs.readFileSync('src/components/meals/MealModal.tsx', 'utf8');

// The bottom is:
//       </div>
//               </>
//         )}
//       </div>
//     </BottomSheet>

code = code.replace(/      <\/div>\n              <\/>\n        \)}\n      <\/div>\n    <\/BottomSheet>/, '        </>\n      )}\n      </div>\n    </BottomSheet>');

fs.writeFileSync('src/components/meals/MealModal.tsx', code);
