# General Engineering Rules & Coding Standards

These rules apply codebase-wide across both `/frontend` and `/backend` directories.

## 1. JavaScript-Only Codebase

- **Extension Guard**: Strictly use `.js` and `.jsx` extensions.
- **No TypeScript**: Do not write `.ts` or `.tsx` files, and never install typescript packages.
- **Typing Fallback**: Document parameters and return structures using standard JSDoc comments where context is complex.

## 2. Naming Conventions

- **Frontend Component Files**: PascalCase (e.g., `ProtectedRoute.jsx`).
- **Backend Files/Routes/Controllers**: camelCase (e.g., `authController.js`).
- **Mongoose Models**: PascalCase Singular (e.g., `User.js`).
- **CSS Classnames**: kebab-case (use Tailwind utility classes primarily).
- **Environment Variables**: UPPER_CASE (e.g., `MONGODB_URI`).

## 3. Path Resolution & Imports

- **Frontend Aliases**: Use `@/` resolving to `/frontend/src/` (e.g., `import Button from '@/components/ui/Button'`). Never use deeply nested relative imports like `../../../../components`.
- **Backend Aliases**: Use relative paths from service folders, following module exports.
- **No Barrel Imports**: Import modules directly from their source files (e.g., `import Button from '@mui/material/Button'` or `import Check from 'lucide-react/dist/esm/icons/check'`) to minimize build size and cold starts.
- **Import Ordering**:
  1. React core hooks and libraries.
  2. External dependencies (Zustand, React Router).
  3. Custom alias modules (`@/components`, `@/utils`).
  4. Local stylesheets/assets.

## 4. Structure & Complexity Bounds

- **React Architecture**: Use functional React components and hooks only.
- **Component Size Limit**: Keep React components under **300 lines of code (LOC)**. If a component exceeds this, refactor sub-elements into separate helper files in the same folder.
- **Component Reuse**: Use shadcn/ui components wherever possible; do not write duplicate code for components that are already available at `../frontend/src/components/ui`.
- **Controller Boundaries**: Backend controller routes should handle validations, pass data to service modules, and map responses. Keep business logic out of controllers; place it in service files.
- **Axios Ban**: Do not import or call `axios` directly inside frontend components. Use centralized API service utilities (`/frontend/src/services`) wrapped in React Query hooks for data fetching.
- **Form Management**: Validate forms with Zod and React Hook Form.
- **State & Workflow Guards**: Follow RBAC and workflow state machine restrictions strictly.
- **Verification Rule**: Do not assume anything. Always verify and run checks.

## 5. System Design & State Management

- **Frontend System Design**: Maintain proper frontend system design rules like Client-Side Rendering (CSR), Server-Side Rendering (SSR), Static Site Generation (SSG), Partial Prerendering (PPR), Incremental Static Regeneration (ISR), Network optimization, Atomic Design Principles, Component Driven Architecture, Monorepos & Module Federation using tools like Webpack or Turborepo.
- **State Management**: Maintain proper data & state management like state categorization (global, local, server, URL), data normalization, cache layering, and Stale-While-Revalidate (SWR) patterns.
- **Networking & API Design**: Manage proper networking and API design by selecting the right communication layer between REST, GraphQL, or RFC models. Implement Backend For Frontend (BFF) patterns, and real-time data streaming using unidirectional Server-Sent Events (SSE), bidirectional WebSockets, or short/long polling.

## 6. Performance Optimization Techniques

- **Code Splitting & Lazy Loading**: Bundling scripts into smaller chunks loaded strictly on-demand to speed up Time to Interactive (TTI).
- **List Virtualization**: Rendering only the items visible in the viewport to maintain 60FPS during infinite scrolls.
- **Resource Prioritization**: Directing browser queues using priority hints like preload, prefetch, and preconnect.
- **Network Request Control**: Optimizing user actions using debouncing, throttling, or request cancellations.
- **Asset Management**: Utilizing next-gen formats (WebP/AVIF), responsive image sets, and SVG icon strategies.
- **Core Web Vitals**: Designing specifically around metrics like LCP (loading), INP (interaction), and CLS (stability).

---

## 7. Skill Selection Protocol

Before any task begins, the agent must evaluate the workspace skills. This applies to:
- New feature development
- UI implementation
- Bug fixing
- Refactoring
- Performance optimization
- Accessibility audits
- React Doctor remediation
- Architecture reviews
- Deployment
- Documentation
- Code reviews

### Selection Rules:
1. Classify the task type first.
2. Inspect available skills listed in `docs/ai/installed-skills.md`.
3. Select the best skill stack.
4. Explain why each skill was selected.
5. Explain expected benefits.
6. Identify missing skills that would improve execution.
7. Generate the implementation plan only after completing the skill selection block.

Every implementation plan must start with the following structure:
```markdown
## Skill Selection

### Primary Skills
* [Skill A]
* [Skill B]

### Supporting Skills
* [Skill C]
* [Skill D]

### Reasoning
* **[Skill A]** → [Why selected]
* **[Skill B]** → [Why selected]

### Alternative Skills Considered
* [Skill E]

### Reason Not Chosen
* [Why not chosen]

### Execution Strategy
* [How these skills will be applied to the current implementation task]
```

---

## 8. Skill Discovery Rule

If an installed skill can improve the quality, maintainability, performance, accessibility, design quality, or development speed of a task by a meaningful amount, the skill must be proposed before implementation. The agent must never silently ignore relevant installed skills. The agent must explain:
- Why the skill is relevant.
- Why it was selected.
- What benefit it provides.

---

## 9. Missing Skill Discovery Workflow

Before starting implementation:
1. Review installed skills.
2. Determine if a better skill exists.
3. If a useful skill is missing:
   - Recommend it.
   - Provide the installation command.
   - Explain the expected benefit.
4. Continue implementation only after documenting the recommendation.

*Example Missing Skill Block:*
> **Task**: Build complex onboarding flow
> - **Current Skills**: `react-components`, `shadcn-ui`
> - **Missing Skill**: `vercel-composition-patterns`
> - **Installation**: `npx skills add vercel-labs/agent-skills --skill vercel-composition-patterns`
> - **Benefit**: Better compound component architecture.
