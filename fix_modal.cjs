const fs = require('fs');
let code = fs.readFileSync('src/components/ui/FamilyModal.tsx', 'utf8');

code = code.replace(
  `                                            {isAdmin && m.user_id !== currentUserId && (
                        <button 
                    </div>
                  ))}
                </div>
              </section>`,
  `                    </div>
                  ))}
                </div>
              </section>`
);

fs.writeFileSync('src/components/ui/FamilyModal.tsx', code);
