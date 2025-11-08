## Incident Summary (2025-11-08)

- **Impact**: The OHIF viewer iframe failed to render thumbnails and DICOM metadata after the latest deployment. End users saw repeated `400` responses from the DICOMweb proxy and a blocking `SyntaxError` logged at `viewer:5`.
- **Detection**: Browser console logs captured by QA showed `Bad Request - caseId parameter required` along with `Uncaught SyntaxError: missing catch or finally after try` originating from the inline interceptor injected into `index.html`.

## Root Cause

- We modified `scripts/inject-interceptor.py`   in the feature branch to force-inject the `caseId` segment into DICOMweb URLs and to append auth headers client-side.
- The generated inline JavaScript suffered from two regressions:
  - **SyntaxError**: the template emitted a `try` block without a valid `catch` in the minified output path, causing the interceptor script to abort before it could install request hooks.
  - **Incorrect URL Rewrite**: when the script did run, it transformed requests like `/dicomweb/studies/<UID>` into `/dicomweb/studies/<caseId>/studies`, leaving the expected `/dicomweb/<caseId>/...` structure missing. The proxy Lambda rejected these requests with `caseId parameter required`.
- Because the interceptor crashed early, the viewer never attached the required `Authorization` / `X-Case-ID` headers, compounding the failures.

## Resolution

1. **Rollback scripts**: Restored the entire `scripts/` folder in `ohif-viewer-bugs-image-load-failed` from the upstream reference repo at `/home/hds-175/repos/ohif-viewer/scripts`.
2. **Redeploy infrastructure** (excluding viewer build):
   - `deploy-stack.sh dev us-east-1`
   - `deploy-proxy.sh dev us-east-1`
   - `update-api-gateway-url.sh dev us-east-1`
3. **Rebuild and publish viewer image**: `build-and-push.sh dev us-east-1 true`, producing ECR tag `20251108-033613`.
4. **Force ECS redeploy**: `aws ecs update-service --cluster sideline-ohif-dev --service sideline-ohif-dev --force-new-deployment --region us-east-1`.

## Follow-Up Actions

- Validate that the restored interceptor behaves as expected by exercising thumbnail load and series navigation once the ECS rollout finishes.
- If case-aware URL rewriting is still required, implement the logic server-side (Lambda proxy) or add comprehensive unit tests before re-introducing client-side rewrites.
- Consider adding automated smoke tests that hit `/dicomweb/{caseId}/studies` during build/deploy to catch malformed URLs before release.


