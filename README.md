# **AiSSISTANT**

AiSSISTANT is an AI-powered chat application that brings together **real-time messaging**, **intelligent writing assistance**, and **live web search**.  
Built using **Stream Chat**, **OpenAI**, and a modern full-stack architecture.

---

## ✨ **Features**

- ⚡ **Real-time chat** powered by Stream Chat  
- 🧠 **AI writing & content generation** using OpenAI  
- 🔍 **Live web search** via Tavily API  
- 🎨 **Responsive React UI** with light/dark themes  
- 🗂️ **Categorized writing prompts**  
- 🤖 **Dynamic AI agent creation** per channel  
- 🔐 **Secure JWT authentication**  

---

## 🏗️ **Architecture Overview**

### 🔧 **Backend**
Built with **Node.js + Express**, providing core functionality:

- Stream Chat server integration  
- OpenAI-powered AI response engine  
- Tavily search integration  
- AI agent lifecycle management  
- JWT authentication system  
- Input validation & CORS configuration  

---

### 🎨 **Frontend**
Developed in **React + TypeScript**, offering a fast and clean interface:

- Stream Chat React components  
- Vite for fast builds  
- Writing prompt tools and AI interaction UI  

---

## 🤖 **AI Agent System**

- Agents are created **per channel** when requested  
- Each agent initializes with **OpenAI** + **web search support**  
- Maintains conversation context  
- Automatically performs web searches when needed  
- Agents are cleaned up after inactivity  

---

## 🔐 **Security**

- JWT-based authentication  
- Environment variable protection  
- Token expiration & refresh handling  
- Server-side input validation  

---

## 🛠️ **Tech Stack**

### **Backend**
- Node.js  
- Express  
- Stream Chat  
- OpenAI  
- Tavily API  
- Axios  
- TypeScript  

### **Frontend**
- React  
- TypeScript  
- Vite  
- Stream Chat React  
- Tailwind CSS  
- shadcn/ui  
- React Router  
- React Hook Form  
