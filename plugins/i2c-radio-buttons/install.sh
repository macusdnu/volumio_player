#!/bin/bash
# Install the required packages via apt-get
sudo apt-get -y install vim build-essential

echo "Installing i2c-radio-buttons Dependencies"
sudo apt-get update -y

# If you need to differentiate install for armhf and i386 you can get the variable like this
ARCH=$(cat /etc/os-release | grep ^VOLUMIO_ARCH | tr -d 'VOLUMIO_ARCH="')
HARDWARE=$(cat /etc/os-release | grep ^VOLUMIO_HARDWARE | tr -d 'VOLUMIO_HARDWARE="')

#requred to end the plugin install
echo "plugininstallend"
