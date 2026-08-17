# Frontend Architecture & Development Rules

These rules apply strictly to developers and AI working in the `/frontend` directory.

## 1. Technologies & Integration Stack

- **Core UI**: React 19, Vite 8, Tailwind CSS v4.
- **Routing**: `react-router-dom` (installed version `^7.18.0`, configured with dynamic placeholder mapping in `routeHelpers.jsx`).
- **Icons**: Lucide React (enforce direct imports of individual SVG components to optimize tree-shaking).

## 2. State & Data Layer

- **State Management (Zustand)**:
  - Separate stores by domain concern (e.g., `/frontend/src/store/useAuthStore.js`, `/frontend/src/store/useInspectionStore.js`).
  - Keep stores focused. Do not mix global UI settings store with domain data store.
  - Subscribe to specific state selectors to prevent unnecessary component re-renders: `const user = useAuthStore((state) => state.user)`.
- **Data Fetching (TanStack React Query)**:
  - Wrap API fetches inside custom hooks (e.g., `/frontend/src/hooks/useApplications.js`).
  - Use `useQuery` for idempotent GET fetches.
  - Use `useMutation` for POST, PUT, DELETE operations, triggering `queryClient.invalidateQueries` upon success to update cached views.

## 3. Forms & Schema Validation

- **Form Management**: Use `react-hook-form` bound to inputs.
- **Validation**: Enforce all form fields validation using `zod` schemas. Export the Zod schema from a shared constant file (`/frontend/src/constants/validationSchemas.js`) so that it can be reused by both the frontend and backend.
- **Errors**: Render inline helper error text matching the Zod schema validation errors.

## 4. Routing & Protection

- **Registry Single-Source-of-Truth**: Never hardcode paths. Import `ROUTE_PATHS` from `@/constants/routePaths.js`.
- **Protected Layouts**: Bind views within `ProtectedRoute` to check role authorization token claims before mounting children.
- **Dynamic Imports**: Use `React.lazy` or dynamic imports for heavy modal overlays, analytics charts, or PDF generator elements to optimize initial bundle load.
