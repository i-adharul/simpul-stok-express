// req.user comes from the authentication middleware and already holds the organization (loaded in
// the same query). Only the documented fields are copied, so nothing else can leak by accident.
function getMe(req, res) {
  const { id, name, email, role, Organization: organization } = req.user;
  res.status(200).json({
    user: { id, name, email, role },
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
        }
      : null,
  });
}

module.exports = { getMe };
