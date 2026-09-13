const fs = require('fs');
let code = fs.readFileSync('src/pages/History.tsx', 'utf8');

code = code.replace(
  `const localDate = getLocalDateString();
      console.log("HISTORY DATAFLOW DEBUG");
      console.log("patientId:", pat.id);
      console.log("localDate:", localDate);`,
  `const localDate = getLocalDateString();`
);

code = code.replace(
  `console.log("historical query start: open");
      console.log("historical query end:", localDate);
      console.log("meal logs returned:", mealLogs.length, mealLogs);
      console.log("medication logs returned:", medLogs.length, medLogs);
      const groups: Record<string, TimelineEvent[]> = {};`,
  `const groups: Record<string, TimelineEvent[]> = {};`
);

code = code.replace(
  `const uniqueDates = Object.keys(groups);
      console.log("unique dates found:", uniqueDates);
      console.log("final accordion groups:", groups);
      uniqueDates.forEach(d => {
        console.log("date:", d, "events count:", groups[d].length);
      });
      setGroupedEvents(groups);`,
  `setGroupedEvents(groups);`
);

fs.writeFileSync('src/pages/History.tsx', code);
