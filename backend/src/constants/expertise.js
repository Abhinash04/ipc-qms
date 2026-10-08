/** The designation a person picks at sign-up to ask for the Assigned Official role. */
export const OFFICER_DESIGNATION = 'Assigned Official';

/**
 * The areas an officer can pick at sign-up. A query rarely names an area outright, so each one also
 * lists the subject phrases that point to it; the Recommendation Engine matches a query against
 * those. Kept to phrases longer than three letters, since matching is by substring. Mirrored in
 * frontend/src/constants/expertise.js.
 */
export const EXPERTISE_AREAS = [
  {
    label: 'Pharmaceutical Analysis',
    keywords: ['assay', 'impurity', 'method validation', 'chromatography', 'hplc', 'spectroscopy', 'titration'],
  },
  {
    label: 'Quality Control',
    keywords: ['dissolution', 'batch release', 'out of specification', 'quality assurance', 'specification'],
  },
  {
    label: 'Regulatory Affairs',
    keywords: ['regulatory', 'submission', 'dossier', 'guideline', 'compliance', 'licensing', 'documentation'],
  },
  {
    label: 'Pharmacology',
    keywords: ['pharmacokinetic', 'pharmacodynamic', 'bioavailability', 'bioequivalence', 'drug interaction'],
  },
  {
    label: 'Microbiology',
    keywords: ['sterility', 'endotoxin', 'microbial limits', 'bioburden', 'contamination', 'antimicrobial'],
  },
  {
    label: 'Toxicology',
    keywords: ['toxicity', 'residual solvent', 'elemental impurities', 'genotoxic', 'safety evaluation'],
  },
  {
    label: 'Drug Testing',
    keywords: ['drug testing', 'sample testing', 'certificate of analysis', 'identification test', 'not of standard quality'],
  },
  {
    label: 'Pharmaceutical Standards',
    keywords: ['monograph', 'reference standard', 'pharmacopoeia', 'iprs', 'specification'],
  },
  {
    label: 'Pharmaceutical Chemistry',
    keywords: ['synthesis', 'degradation', 'stability', 'excipient', 'formulation'],
  },
  {
    label: 'Laboratory Instrumentation',
    keywords: ['instrumentation', 'calibration', 'laboratory operations', 'equipment', 'good laboratory practice'],
  },
];

const AREA_TERMS = new Map(
  EXPERTISE_AREAS.map(({ label, keywords }) => [label.toLowerCase(), [label.toLowerCase(), ...keywords]]),
);

/**
 * The phrases a query is matched against for an officer's expertise: an area expands to its own
 * name plus its subject phrases, anything else (an "Other" entry, a built-in keyword) stands as is.
 */
export function expandExpertise(phrases = []) {
  const terms = new Set();
  for (const phrase of phrases) {
    const wanted = String(phrase || '').trim().toLowerCase();
    if (!wanted) continue;
    for (const term of AREA_TERMS.get(wanted) || [wanted]) terms.add(term);
  }
  return [...terms];
}
