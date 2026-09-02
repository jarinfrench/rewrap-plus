def deploy(really_long_deployment_target_identifier, dry_run=False):
    """Deploy to the given target, with café-safe
    unicode handling ✨.

    Args:
        really_long_deployment_target_identifier: A
                                                  verbose
                                                  identifier
                                                  naming
                                                  the
                                                  deployment
                                                  target.
        dry_run: Options include the following
                 steps
                 - printing each step as it
                   executes
                 - aborting immediately on the
                   first warning
                 An example follows.
                 ```
                 deploy("prod-eu-west", dry_run=True)
                 ```

    Returns:
        None: Nothing is returned.
    """
    return _do_deploy(really_long_deployment_target_identifier, dry_run)
