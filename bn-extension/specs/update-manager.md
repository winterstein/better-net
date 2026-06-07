Specifcations for update-manager

Several systems can use domain-specific setup, which should be updated regularly.

The extension ships with snapshot files.
It can download updated files.
It maintains info on when they were last updated, and checks regularly for if there is an update.

Example areas that get updates:

 - Off-by-default domains x features (e.g. don't run ad-blocker or fact-checker on gov.uk)
 - xpath patterns for chunking specific domains

 The update-manager is not feature specific - it provides a service that feature modules can use.