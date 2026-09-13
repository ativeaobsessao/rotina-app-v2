const fs = require('fs');
let code = fs.readFileSync('src/components/ui/FamilyModal.tsx', 'utf8');

// Fix first modal ending
code = code.replace(
  `        </div>
      </div>
    </div>

    {/* INVITE GENERATION MODAL */}`,
  `        </div>
        </div>
      </div>
    </div>

    {/* INVITE GENERATION MODAL */}`
);

// Fix second modal ending
code = code.replace(
  `            </>
          )}

        </div>
      </div>
    )}
    </>
  );
}`,
  `            </>
          )}

        </div>
        </div>
      </div>
    )}
    </>
  );
}`
);

fs.writeFileSync('src/components/ui/FamilyModal.tsx', code);
