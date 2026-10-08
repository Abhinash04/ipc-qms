/** The designation a person picks at sign-up to ask for the Assigned Official role. */
export const OFFICER_DESIGNATION = 'Assigned Official';

/**
 * The areas an officer can pick at sign-up, each with the subject phrases that point to it.
 * Mirrors backend/src/constants/expertise.js; enumParity.test.js keeps the two identical.
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

/** The phrases a query is matched against: an area expands to its subject phrases, anything else stands as is. */
export function expandExpertise(phrases = []) {
  const terms = new Set();
  for (const phrase of phrases) {
    const wanted = String(phrase || '').trim().toLowerCase();
    if (!wanted) continue;
    for (const term of AREA_TERMS.get(wanted) || [wanted]) terms.add(term);
  }
  return [...terms];
}
