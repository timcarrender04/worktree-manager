#!/bin/bash

# Script to fix Docker permissions by adding user to docker group

echo "🔧 Fixing Docker permissions..."
echo ""
echo "Current user: $(whoami)"
echo "Current groups: $(groups)"
echo ""

# Check if user is already in docker group
if groups | grep -q docker; then
    echo "✅ User is already in the docker group!"
    echo "If you're still getting permission errors, try:"
    echo "  1. Log out and log back in, OR"
    echo "  2. Run: newgrp docker"
else
    echo "📝 Adding user to docker group..."
    sudo usermod -aG docker $USER
    
    echo ""
    echo "✅ User added to docker group!"
    echo ""
    echo "⚠️  IMPORTANT: You need to log out and log back in for the changes to take effect."
    echo "   OR you can run: newgrp docker"
    echo ""
    echo "After logging back in, verify with: groups"
fi



