FROM node:22-alpine

RUN apk add --no-cache bluez bluez-deprecated bluez-libs bash libcap python3 py3-pip make g++ git

#RUN setcap cap_net_raw+eip $(eval readlink -f `which node`)

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npx", "nest", "start"]
