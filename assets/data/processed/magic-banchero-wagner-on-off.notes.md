# Orlando Banchero/Wagner on/off preparation notes

- Raw source: `assets/data/raw/Wagner&Paolo_OnOff_Career.csv`.
- Preparation script: `scripts/prepare_magic_on_off.py`.
- Coverage label: “PBP Stats selection beginning in 2022-23.”
- The supplied table does not establish an exact end date or season-type filter. Those details remain unresolved.
- Blank `Players On` or `Players Off` cells are valid empty player lists, not missing data.
- Shooting percentages are normalized from percent strings to decimal fractions. All four source shooting columns are retained.
- The four rows are one pooled WOWY Combinations table. They are not season-level splits and do not supply possession counts or confidence intervals.
- The chart reports the source ratings directly and does not average the four groups into a team figure.
